const { gql } = require("@apollo/client")
const { getTypeMap } = require('./api');
const {
  getEntityResponseCollection,
  getCollectionTypes,
  getCollectionTypeMap,
  filterExcludedTypes,
} = require('./helpers');

const getNodeFields = (node, typeMap, n = 0, root = false) => {
  const max = 16;
  if (n > max) {
    return null;
  }

  const flatten = true;
  const sep = flatten ? ' ' : '\n';
  const dep = i => Array.from(new Array(i), () => flatten ? '' : '  ').join('');

  switch (node.__typename) {
    case '__Type':
      switch (node.kind) {
        case 'OBJECT':
          // Prevent circular propagation.
          const relationship = /Entity$/.test(node?.name);
          if (relationship) {
            return [`${dep(n)}id`];
          }
          if (node?.fields) {
            if (root) {
              return node.fields.filter(filterExcludedTypes).map(child => getNodeFields(child, typeMap, n)).join(sep);
            }
            return node.fields.filter(filterExcludedTypes).map(child => getNodeFields(child, typeMap, n));
          }
          const child = typeMap?.[node?.name];
          if (child) {
            return getNodeFields(child, typeMap, n);
          }
          return null;
        case 'UNION': {
          const child = typeMap?.[node?.name];
          if (child) {
            return [`${dep(n)}__typename`, ...child.possibleTypes.map(possibleType => {
              const grandchild = typeMap?.[possibleType?.name];
              if (grandchild) {
                // Prevent circular propagation.
                const relationship = /Entity$/.test(node?.name);
                if (relationship) {
                  return [`${dep(n)}id`];
                }
                const fields = getNodeFields(grandchild, typeMap, n + 1);
                if (fields) {
                  return `${dep(n)}... on ${possibleType.name} {${sep}${[`${dep(n + 1)}__typename`, ...fields].join(sep)}${sep + dep(n)}}`;
                }
              }
            })];
          }
          return null;
        }
        case 'ENUM': {
          const child = typeMap?.[node?.name];
          if (child) {
            return [`${dep(n + 1)}__typename`, ...child.enumValues.map(({ name }) =>
              `${dep(n + 1)}${name}`,
            )].join(sep);
          }
          break;
        }
        default:
          return null;
      }
    case '__Field': {
      switch (node.type.kind) {
        case 'SCALAR':
        case 'ENUM':
          return `${dep(n)}${node.name}`;
        case 'NON_NULL':
          return getNodeFields({ ...node, type: node.type?.ofType }, typeMap, n);
        case 'OBJECT': {
          const fields = getNodeFields(node.type, typeMap, n + 1);
          if (fields) {
            return `${dep(n)}${node.name} {${sep}${[`${dep(n + 1)}__typename`, ...fields].join(sep)}${sep + dep(n)}}`;
          }
          break;
        }
        case 'LIST':
          const fields = getNodeFields(node.type?.ofType, typeMap, n + 1);
          if (typeof fields === 'string') {
            return `${dep(n)}${node.name} {${sep}${fields}${sep + dep(n)}}`;
          } else if (fields?.length) {
            return `${dep(n)}${node.name} {${sep}${fields.join(sep)}${sep + dep(n)}}`;
          }
          break;
        default:
          return null;
      }
    }
  }
  return null;
};

const buildQueries = (operations, typeMap) => {
  return operations.map(operation => {
    const operationName = `${operation.collectionType}Query`;
    const publicationState = Boolean(operation.field.args.find(arg => arg.name === 'publicationState'));
    const locale = Boolean(operation.field.args.find(arg => arg.name === 'locale'));
    const filterInputType = typeMap?.[operation.field.args.find(arg => arg.name === 'filters')?.type?.name];
    const updatedAt = Boolean((filterInputType?.inputFields || []).find(input => input.name === 'updatedAt'));
    const varDef = [
      '$pagination: PaginationArg',
      publicationState && '$publicationState: PublicationState',
      locale && '$locale: I18NLocaleCode',
      updatedAt && '$updatedAt: DateTime',
    ].filter(n => Boolean(n)).join(' ');
    const varSet = [
      'pagination: $pagination',
      publicationState && 'publicationState: $publicationState',
      locale && 'locale: $locale',
      updatedAt && 'filters: { updatedAt: { gt: $updatedAt } }',
    ].filter(n => Boolean(n)).join(' ');
    const variables = {
      pagination: { start: 0, limit: 1000 },
      ...publicationState && { publicationState: 'LIVE' },
      ...locale && { locale: 'all' },
      ...updatedAt && { updatedAt: "1990-01-01T00:00:00.000Z" },
    };
    const meta = `meta { pagination { total } }`;
    const data = `__typename data { __typename id attributes { __typename ${operation.query} } } ${meta}`;
    const query = gql`query ${operationName}(${varDef}) { ${operation.field.name}(${varSet}) { ${data} } }`;
    const syncQuery = gql`query ${operationName}(${varDef}) { ${operation.field.name}(${varSet}) { data { id } ${meta} } }`;
    return {
      ...operation,
      operationName,
      variables,
      query,
      syncQuery,
    };
  });
};

const getQueryFields = (collectionTypeMap, typeMap) => {
  const Query = typeMap?.Query;
  return Query.fields.reduce((acc, field) => {
    const collectionType = getEntityResponseCollection(field.type.name);
    if (collectionTypeMap?.[collectionType]) {
      const type = typeMap?.[collectionType];
      acc.push({
        field,
        query: getNodeFields(type, typeMap, 4, true),
        collectionType,
      });
    }
    return acc;
  }, []);
}

module.exports = async pluginOptions => {
  const collectionTypes = getCollectionTypes(pluginOptions);
  const collectionTypeMap = getCollectionTypeMap(collectionTypes);
  const typeMap = await getTypeMap(pluginOptions);
  const fields = getQueryFields(collectionTypeMap, typeMap);
  return buildQueries(fields, typeMap);
};