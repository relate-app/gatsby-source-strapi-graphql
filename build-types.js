const { getTypesMap } = require('./api');
const {
  filterExcludedTypes,
  getFieldType,
  getTypeMap,
  getTypeName,
  getTypeKind,
  getEntityType,
  getEntityTypes,
  isListType,
} = require('./helpers');

const getTypeDefs = (typeNames, typeMap, schema, entityTypeMap, inlineImages) => {
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
                    type: isListType(fieldTypeName) ? `[${typeName}]` : typeName,
                    resolve: (source, _, context) => {
                      const nodeId = source?.[field.name]?.nodeId;
                      if (nodeId) {
                        return context.nodeModel.getNodeById({
                          id: nodeId,
                          type: typeName,
                        });
                      }
                      const nodeIds = source?.[field.name]?.nodeIds;
                      if (nodeIds) {
                        return context.nodeModel.getNodesByIds({
                          ids: nodeIds,
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
              const fieldTypeKind = getTypeKind(field.type);
              switch (fieldTypeKind) {
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
            strapiId: {
              type: 'Int',
              resolve: source => source?.strapiId || null,
            },
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
            ...(inlineImages?.[type.name] || []).reduce((acc, field) => {
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
                [`${field}_markdown`]: {
                  type: 'MarkdownRemark',
                  resolve: async (source, _, context) => {
                    const id = source?.[`${field}_markdown`];
                    return context.nodeModel.getNodeById({ id });
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

module.exports = async (pluginOptions, schema) => {
  const entityTypes = getEntityTypes(pluginOptions);
  const entityTypeMap = getTypeMap(entityTypes);
  const typeMap = await getTypesMap(pluginOptions);
  const inlineImages = pluginOptions?.inlineImages?.typesToParse;
  const result = getTypeDefs(entityTypes, typeMap, schema, entityTypeMap, inlineImages);
  return Object.values(result);
};
