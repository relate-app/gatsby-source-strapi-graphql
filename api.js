const { gql } = require("@apollo/client")
const client = require('./client');

const query = gql`query IntrospectionQuery { __schema { queryType { name } mutationType { name } subscriptionType { name } types { ...FullType } directives { name description locations args { ...InputValue } } } } fragment FullType on __Type { kind name description fields(includeDeprecated: true) { name description args { ...InputValue } type { ...TypeRef } isDeprecated deprecationReason } inputFields { ...InputValue } interfaces { ...TypeRef } enumValues(includeDeprecated: true) { name description isDeprecated deprecationReason } possibleTypes { ...TypeRef } } fragment InputValue on __InputValue { name description type { ...TypeRef } defaultValue } fragment TypeRef on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } }`;

const getClient = ({ apiURL } = {}) => {
  return client(apiURL);
}

const getSchema = async (pluginOptions) => {
  const { data } = await getClient(pluginOptions).query({ query });
  return data?.__schema || {};
}

const getTypes = async pluginOptions => {
  const { types } = await getSchema(pluginOptions);
  return types;
}

const getTypeMap = async pluginOptions => {
  const types = await getTypes(pluginOptions);
  return types.reduce((acc, type) => Object.assign(acc, { [type.name]: type }), {});
};

module.exports = {
  getSchema,
  getTypes,
  getTypeMap,
  getClient,
};