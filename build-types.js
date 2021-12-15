const { getTypesMap } = require('./api');
const {
  filterExcludedTypes,
  getFieldType,
  getTypeMap,
  getTypeName,
  getEntityType,
  getEntityTypes,
} = require('./helpers');

const getTypeDefs = (typeNames, typeMap, schema, entityTypeMap, markdownImages) => {
  const typeDefs = {};
  const foundTypes = [];
  for (let typeName of typeNames) {
    if (typeMap?.[typeName]) {
      foundTypes.push(typeName);
    } else {
      console.warn('Could not find type: ', typeName);
    }
  }
  for (let i = 0; i < foundTypes.length; i += 1) {
    const name = foundTypes[i];
    const type = typeMap?.[name];

    switch (type.kind) {
      case 'OBJECT':
        typeDefs[type.name] = schema.buildObjectType({
          name: `Strapi${type.name}`,
          ...entityTypeMap[type.name] && { interfaces: ['Node'] },
          fields: type.fields.filter(filterExcludedTypes).reduce((acc, field) => {
            const fieldTypeName = getTypeName(field.type);
            // Add relationship resolver referenced collections.
            const entityType = getEntityType(fieldTypeName);
            if (entityType) {
              if (entityTypeMap?.[entityType]) {
                const typeName = `Strapi${entityType}`;
                return Object.assign(acc, {
                  [field.name]: {
                    type: typeName,
                    resolve: (source, _, context) => {
                      const nodeId = source?.[field.name]?.id;
                      if (nodeId) {
                        return context.nodeModel.getNodeById({
                          id: nodeId,
                          type: typeName,
                        });
                      }
                      return null;
                    },
                  },
                });
              }
              return acc;
            } else {
              switch (field.type.kind) {
                case 'OBJECT':
                case 'LIST': {
                  if (!typeDefs?.[fieldTypeName]) {
                    foundTypes.push(fieldTypeName);
                  }
                  break;
                }
              }
            }
            return Object.assign(acc, { [field.name]: getFieldType(field.type) });
          }, {
            ...type.name === 'UploadFile' && {
              file: {
                type: 'File',
                resolve: (source, _, context) => {
                  const fileId = source?.file;
                  if (fileId) {
                    return context.nodeModel.getNodeById({
                      id: fileId,
                      type: 'File',
                    });
                  }
                  return null;
                },
              },
            },
            ...(markdownImages?.[type.name] || []).reduce((acc, field) => {
              return {
                ...acc,
                [`${field}_images`]: {
                  type: '[File]',
                  resolve: async (source, _, context) => {
                    const fileIds = source?.[`${field}_images`] || [];
                    return context.nodeModel.getNodesByIds({
                      ids: fileIds,
                      type: 'File',
                    });
                  },
                },
              }
            }, {}),
          }),
        });
        break;

      case 'UNION':
        typeDefs[type.name] = schema.buildUnionType({
          name: `Strapi${type.name}`,
          resolveType: value => `Strapi${value.__typename}`,
          types: type.possibleTypes.map(unionType => {
            const unionTypeName = getTypeName(unionType);
            if (!typeDefs?.[unionTypeName]) {
              foundTypes.push(unionTypeName);
            }
            return `Strapi${unionType.name}`;
          }, {}),
        });
      
      default:
        break;
    }
  };

  return typeDefs;
}

module.exports = async (pluginOptions, schema, createNodeId) => {
  const entityTypes = getEntityTypes(pluginOptions);
  const entityTypeMap = getTypeMap(entityTypes);
  const typeMap = await getTypesMap(pluginOptions);
  const markdownImages = pluginOptions?.markdownImages?.typesToParse;
  const result = getTypeDefs(entityTypes, typeMap, schema, entityTypeMap, markdownImages);
  return Object.values(result);
};
