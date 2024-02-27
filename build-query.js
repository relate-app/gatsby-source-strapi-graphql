const { gql } = require("@apollo/client")
const { getTypesMap, getLocales } = require('./api');
const {
  getEntityResponse,
  getEntityResponseCollection,
  getCollectionTypes,
  getSingleTypes,
  getTypeMap,
  filterExcludedTypes,
} = require('./helpers');

const buildArgs = node => {
  const args = [];
  // Get all data for paginated fields.
  if (node?.args?.find(arg => arg.name === 'pagination')) {
    args.push('pagination:{limit:1000}');
  }
  return args.length ? `(${args.join(',')})` : '';
}

const getNodeFields = (node, typesMap, n = 0, root = false) => {
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
          if (/Entity$/.test(node?.name)) {
            return [`${dep(n)}id`];
          } else if (/RelationResponseCollection$/.test(node?.name)) {
            return [`${dep(n)}data { __typename id }`];
          }
          if (node?.fields) {
            if (root) {
              return node.fields.filter(filterExcludedTypes).map(child => getNodeFields(child, typesMap, n)).join(sep);
            }
            return node.fields.filter(filterExcludedTypes).map(child => getNodeFields(child, typesMap, n));
          }
          const child = typesMap?.[node?.name];
          if (child) {
            return getNodeFields(child, typesMap, n);
          }
          return null;
        case 'UNION': {
          const child = typesMap?.[node?.name];
          if (child) {
            return [`${dep(n)}__typename`, ...child.possibleTypes.map(possibleType => {
              const grandchild = typesMap?.[possibleType?.name];
              if (grandchild) {
                // Prevent circular propagation.
                if (/Entity$/.test(node?.name)) {
                  return [`${dep(n)}id`];
                } else if (/RelationResponseCollection$/.test(node?.name)) {
                  return [`${dep(n)}data { __typename id }`];
                }
                const fields = getNodeFields(grandchild, typesMap, n + 1);
                if (fields) {
                  return `${dep(n)}... on ${possibleType.name} {${sep}${[`${dep(n + 1)}__typename`, ...fields].join(sep)}${sep + dep(n)}}`;
                }
              }
            })];
          }
          return null;
        }
        case 'ENUM': {
          const child = typesMap?.[node?.name];
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
          return getNodeFields({ ...node, type: node.type?.ofType }, typesMap, n);
        case 'OBJECT': {
          const fields = getNodeFields(node.type, typesMap, n + 1);
          if (fields) {
            const args = buildArgs(node);
            return `${dep(n)}${node.name}${args} {${sep}${[`${dep(n + 1)}__typename`, ...fields].join(sep)}${sep + dep(n)}}`;
          }
          break;
        }
        case 'LIST':
          const fields = getNodeFields(node.type?.ofType, typesMap, n + 1);
          const args = buildArgs(node);
          if (typeof fields === 'string') {
            return `${dep(n)}${node.name}${args} {${sep}${fields}${sep + dep(n)}}`;
          } else if (fields?.length) {
            return `${dep(n)}${node.name}${args} {${sep}${fields.join(sep)}${sep + dep(n)}}`;
          }
          break;
        default:
          return null;
      }
    }
  }
  return null;
};

const buildQueries = (operations, typesMap, pluginOptions) => {
  return operations.map(operation => {
    const isCollectionType = operation?.collectionType;
    const operationName = `${operation.collectionType || operation.singleType}Query`;
    const publicationState = Boolean(operation.field.args.find(arg => arg.name === 'publicationState'));
    const locale = Boolean(operation.field.args.find(arg => arg.name === 'locale'));
    const localeDef = operation.query.includes('$locale');
    const filterInputType = typesMap?.[operation.field.args.find(arg => arg.name === 'filters')?.type?.name];
    const updatedAt = Boolean((filterInputType?.inputFields || []).find(input => input.name === 'updatedAt'));
    const updatedAtDef = operation.query.includes('$updatedAt');
    const varDef = [
      isCollectionType && '$pagination: PaginationArg',
      (locale || localeDef) && '$locale: I18NLocaleCode',
      (updatedAt || updatedAtDef) && '$updatedAt: DateTime',
    ].filter(n => Boolean(n)).join(' ').replace(/(.+)/, '($1)');
    const varSet = [
      isCollectionType && 'pagination: $pagination',
      publicationState && pluginOptions?.preview && `publicationState: PREVIEW`,
      locale && 'locale: $locale',
      updatedAt && 'filters: { updatedAt: { gt: $updatedAt } }',
    ].filter(n => Boolean(n)).join(' ').replace(/(.+)/, '($1)');
    const variables = {
      ...isCollectionType && { pagination: { start: 0, limit: 1000 } },
      ...(locale || localeDef) && { locale: operation.locale },
      ...(updatedAt || updatedAtDef) && { updatedAt: "1990-01-01T00:00:00.000Z" },
    };
    const meta = isCollectionType ? ` meta { pagination { total } }` : '';
    const data = `__typename data { __typename id attributes { __typename ${operation.query} } }${meta}`;
    const query = gql`query ${operationName}${varDef} { ${operation.field.name}${varSet} { ${data} } }`;
    const syncQuery = gql`query ${operationName}${varDef} { ${operation.field.name}${varSet} { data { id }${meta} } }`;
    return {
      ...operation,
      operationName,
      variables,
      query,
      syncQuery,
    };
  });
};

const getQueryFields = (singleTypes, collectionTypeMap, typesMap, locales) => {
  const Query = typesMap?.Query;
  return Query.fields.reduce((acc, field) => {
    const singleType = getEntityResponse(field.type.name);
    const collectionType = getEntityResponseCollection(field.type.name);
    if (collectionTypeMap?.[collectionType]) {
      const type = typesMap?.[collectionType];
      locales.forEach(locale => {
        acc.push({
          field,
          query: getNodeFields(type, typesMap, 4, true),
          collectionType,
          locale,
        });
      });
    }
    if (singleTypes?.[singleType]) {
      const type = typesMap?.[singleType];
      locales.forEach(locale => {
        acc.push({
          field,
          query: getNodeFields(type, typesMap, 4, true),
          singleType,
          locale,
        });
      });
    }
    return acc;
  }, []);
}

module.exports = async pluginOptions => {
  const collectionTypes = getCollectionTypes(pluginOptions);
  const collectionTypeMap = getTypeMap(collectionTypes);
  const singleTypes = getSingleTypes(pluginOptions);
  const singleTypeMap = getTypeMap(singleTypes);
  const typesMap = await getTypesMap(pluginOptions);
  const locales = await getLocales(pluginOptions);
  const fields = getQueryFields(singleTypeMap, collectionTypeMap, typesMap, locales);
  return buildQueries(fields, typesMap, pluginOptions);
};
