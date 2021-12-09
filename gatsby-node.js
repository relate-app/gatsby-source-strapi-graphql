
const buildTypes = require('./build-types');
const { catchErrors, processFieldData } = require('./helpers');
const buildQueries = require('./build-query');
const { getClient } = require('./api');

/**
 * Implementing Gatsby's Node APIs.
 *
 * See: https://www.gatsbyjs.com/docs/node-apis/#createSchemaCustomization
 */
exports.createSchemaCustomization = async ({ actions, schema, createNodeId }, pluginOptions) => {
  const { createTypes } = actions;
  const typeDefs = await buildTypes(pluginOptions, schema, createNodeId);
  createTypes(typeDefs);
};

/**
 * Implementing Gatsby's Node APIs.
 *
 * See: https://www.gatsbyjs.com/docs/node-apis/#sourceNodes
 */
exports.sourceNodes = async ({
  actions,
  reporter,
  createContentDigest,
  createNodeId,
  getCache,
  getNode,
  cache,
}, pluginOptions) => {
  const lastFetched = await cache.get(`timestamp`);
  const { createNode, touchNode } = actions;
  const operations = await buildQueries(pluginOptions);
  const client = getClient(pluginOptions);
  await Promise.all(operations.map(async operation => {
    const { operationName, field, collectionType, query, syncQuery } = operation;
    try {
      const NODE_TYPE = `Strapi${collectionType}`;
      const variables = {
        ...operation?.variables,
        ...lastFetched && operation?.variables?.updatedAt && {
          updatedAt: new Date(lastFetched).toISOString(),
        },
      };
      const { data, error } = await client.query({ query, variables });
      await Promise.all([(async () => {
        if (lastFetched) {
          const { updatedAt, ...syncVariables } = variables;
          const syncResult = await client.query({ query: syncQuery, variables: syncVariables });
          const nodes = syncResult?.data?.[field.name]?.data || [];
          nodes.forEach(node => {
            const nodeId = createNodeId(`${NODE_TYPE}-${node.id}`);
            touchNode(getNode(nodeId));
          });
        }
      })(), (async () => {
        await Promise.all(data?.[field.name]?.data.map(async item => {
          const { id, attributes } = item || {};
          const nodeId = createNodeId(`${NODE_TYPE}-${id}`);
          const options = { nodeId, createNode, createNodeId, pluginOptions, getCache };
          const fields = await processFieldData(attributes, options);
          await createNode({
            ...fields,
            id: nodeId,
            parent: null,
            children: [],
            internal: {
              type: NODE_TYPE,
              content: JSON.stringify(fields),
              contentDigest: createContentDigest(fields),
            },
          });
        }));
      })()]);
    } catch (err) {
      catchErrors(err, operation, reporter);
    }
  }));
};

exports.onPostBuild = async ({ cache }) => {
  await cache.set(`timestamp`, Date.now())
};
