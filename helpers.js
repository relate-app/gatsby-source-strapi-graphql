const { print } = require("graphql");
const { createRemoteFileNode } = require(`gatsby-source-filesystem`);
const commonmark = require('commonmark');

const reader = new commonmark.Parser();
const excludedTypes = ['GenericMorph'];

const catchErrors = (err, operation, reporter) => {
  if (err?.networkError?.result?.errors) {
    err.networkError.result.errors.forEach(error => {
      reportOperationError(reporter, operation, error);
    });
  } else if (err?.graphQLErrors) {
    err.graphQLErrors.forEach(error => {
      reportOperationError(reporter, operation, error);
    });
  } else {
    reportOperationError(reporter, operation, err);
  }
};

const filterExcludedTypes = node => {
  const type = getTypeName(node.type);
  return !excludedTypes.includes(type);
};

const formatCollectionName = name => {
  return name
    ?.replace(/([a-z])([A-Z])/, '$1 $2')
    ?.replace(/\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    ?.replace(/\W+/g, '');
}

const getFieldType = (type, strapi = false) => {
  if (type.name === 'DateTime' || type.name === 'Date' || type.name === 'Time') {
    return 'Date';
  }
  if (type.name === 'Long') {
    return 'Float';
  }
  switch (type.kind) {
    case 'ENUM':
      return 'String';
    case 'LIST':
      return `[${getFieldType(type.ofType)}]`;
    case 'NON_NULL':
      return `${getFieldType(type.ofType)}!`;
    case 'OBJECT':
    case 'UNION':
      return `Strapi${type.name}`;
    default:
      return type.name;
  }
}

const getTypeName = type => {
  if (type.name === 'DateTime' || type.name === 'Date' || type.name === 'Time') {
    return 'Date';
  }
  if (type.name === 'Long') {
    return 'Float';
  }
  switch (type.kind) {
    case 'ENUM':
      return 'String';
    case 'LIST':
      return getTypeName(type.ofType);
    case 'NON_NULL':
      return getTypeName(type.ofType);
    default:
      return type.name;
  }
}

const getTypeKind = type => {
  switch (type.kind) {
    case 'NON_NULL':
      return getTypeKind(type.ofType);
    default:
      return type.kind;
  }
}

const getEntityType = name =>
  name.match(/(.*)(?:EntityResponse|EntityResponseCollection|RelationResponseCollection)$/)?.[1];

const isListType = name => {
  return /(?:EntityResponseCollection|RelationResponseCollection)$/.test(name);
};

const getEntityResponse = name =>
  name.match(/(.*)(?:EntityResponse)$/)?.[1];

const getEntityResponseCollection = name =>
  name.match(/(.*)(?:EntityResponseCollection)$/)?.[1];

const getCollectionType = name =>
  name.match(/(.*)(?:EntityResponse|RelationResponseCollection)$/)?.[1];

const getSingleTypes = ({ singleTypes }) =>
  [...singleTypes || []].map(formatCollectionName).filter(Boolean);

const getCollectionTypes = ({ collectionTypes }) =>
  ['UploadFile', ...collectionTypes || []].map(formatCollectionName).filter(Boolean);

const getEntityTypes = ({ collectionTypes, singleTypes }) =>
  ['UploadFile', ...collectionTypes || [], ...singleTypes || []].map(formatCollectionName).filter(Boolean);

const getTypeMap = collectionTypes =>
  (collectionTypes || []).reduce((ac, a) => ({ ...ac, [a]: true }), {});

const reportOperationError = (reporter, operation, error) => {
  const { operationName, field, collectionType, query, variables } = operation;
  const extra = `
===== QUERY =====
${print(query)}
===== VARIABLES =====
${JSON.stringify(variables, null, 2)}
===== ERROR =====
`;
  reporter.error(`${operationName} failed – ${error.message}\n${extra}`, error);
};

const extractFiles = (text, apiURL) => {
  const files = [];

  if (!text) {
    return files;
  }

  // parse the markdown / richtext content
  const parsed = reader.parse(text)
  const walker = parsed.walker()
  let event, node

  while ((event = walker.next())) {
    node = event.node
    // process image nodes
    if (event.entering && node.type === 'image') {
      if (/^\//.test(node.destination)) {
        files.push(`${apiURL}${node.destination}`);
      } else if (/^http/i.test(node.destination)) {
        files.push(node.destination);
      }
    } else if (event.entering && node.type === 'html_block' && node.literal) {
      let match
      const regex = /<img[^>]+src="?([^"\s]+)"?\s*/gi

      while (match = regex.exec(node.literal)) {
        if (/^\//.test(match[1])) {
          files.push(`${apiURL}${match[1]}`);
        } else if (/^http/i.test(match[1])) {
          files.push(match[1]);
        }
      }
    }
  }

  return files.filter(Boolean);
};

const processFieldData = async (data, options) => {
  const { pluginOptions, nodeId, createNode, createNodeId, getCache } = options || {};
  const apiURL = pluginOptions?.apiURL;
  const inlineImages = pluginOptions?.inlineImages?.typesToParse;
  const __typename = data?.__typename;
  const output = JSON.parse(JSON.stringify(data));

  // Extract files and download.
  if (__typename === 'UploadFile' && data.url) {
    const url = /^\//.test(data.url) ? `${apiURL}${data.url}` : data.url;
    const fileNode = await createRemoteFileNode({
      url,
      parentNodeId: nodeId,
      createNode,
      createNodeId,
      getCache,
      httpHeaders: pluginOptions.headers || {},
    });
    if (fileNode) {
      output.file = fileNode.id;
    }
  }
  // Extract markdown / richtext files and download.
  if (inlineImages?.[__typename]) {
    await Promise.all((inlineImages[__typename] || []).map(async field => {
      const files = extractFiles(data[field], apiURL);
      if (files?.length) {
        await Promise.all(files.map(async (url, index) => {
          const fileNode = await createRemoteFileNode({
            url,
            parentNodeId: nodeId,
            createNode,
            createNodeId,
            getCache,
          });
          if (fileNode) {
            if (!output?.[`${field}_images`]) {
              output[`${field}_images`] = [];
            }
            output[`${field}_images`][index] = fileNode.id;
          }
        }));
      }
    }));
  }

  await Promise.all(Object.keys(data).map(async key => {
    const value = data?.[key];
    if (value?.__typename) {
      const entityType = getEntityType(value.__typename);
      if (entityType && value?.data) {
        if (value.data.length) {
          output[key].nodeIds = value.data.map(item => createNodeId(`Strapi${entityType}-${item.id}`));
        } else if (value.data.id) {
          output[key].nodeId = createNodeId(`Strapi${entityType}-${value.data.id}`);
        } else {
          output[key] = null;
        }
      } else {
        output[key] = await processFieldData(value, options);
      }
    } else if (value instanceof Array) {
      output[key] = await Promise.all(value.map(item => processFieldData(item, options)));
    }
  }));

  return output;
}

let warnOnceForNoSupport = false
const createNodeManifest = (uid, id, node, unstable_createNodeManifest) => {
  // This env variable is provided automatically on Gatsby Cloud hosting
  const isPreview = process.env.GATSBY_IS_PREVIEW === 'true';
  const createNodeManifestIsSupported =
    typeof unstable_createNodeManifest === 'function';
  const shouldCreateNodeManifest = isPreview && createNodeManifestIsSupported;
  if (shouldCreateNodeManifest) {
    if (uid && id && node?.updatedAt) {
      const updatedAt = node.updatedAt;
      const manifestId = `${uid}-${id}-${updatedAt}`;
      unstable_createNodeManifest({
        manifestId,
        node,
        updatedAtUTC: updatedAt,
      });
    }
  } else if (
    // it's helpful to let users know if they're using an outdated Gatsby version so they'll upgrade for the best experience
    isPreview && !createNodeManifestIsSupported && !warnOnceForNoSupport
  ) {
    console.warn(
      `${sourcePluginName}: Your version of Gatsby core doesn't support Content Sync (via the unstable_createNodeManifest action). Please upgrade to the latest version to use Content Sync in your site.`
    )
    // This is getting called for every entry node so we don't want the console logs to get cluttered
    warnOnceForNoSupport = true
  }
}

module.exports = {
  catchErrors,
  createNodeManifest,
  filterExcludedTypes,
  getEntityResponse,
  getEntityResponseCollection,
  getEntityType,
  getEntityTypes,
  getCollectionType,
  getCollectionTypes,
  getSingleTypes,
  getTypeKind,
  getTypeMap,
  getTypeName,
  getFieldType,
  isListType,
  processFieldData,
};
