const { gql } = require("@apollo/client")
const client = require('./client');

const query = gql`query IntrospectionQuery { __schema { queryType { name } mutationType { name } subscriptionType { name } types { ...FullType } directives { name description locations args { ...InputValue } } } } fragment FullType on __Type { kind name description fields(includeDeprecated: true) { name description args { ...InputValue } type { ...TypeRef } isDeprecated deprecationReason } inputFields { ...InputValue } interfaces { ...TypeRef } enumValues(includeDeprecated: true) { name description isDeprecated deprecationReason } possibleTypes { ...TypeRef } } fragment InputValue on __InputValue { name description type { ...TypeRef } defaultValue } fragment TypeRef on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } }`;

const getClient = ({ apiURL, headers, token } = {}) => {
  return client(apiURL, headers, token);
}

const getSchema = async (pluginOptions) => {
  const { data } = await getClient(pluginOptions).query({ query });
  return data?.__schema || {};
}

const getTypes = async pluginOptions => {
  const { types } = await getSchema(pluginOptions);
  return types;
}

const getSpecifiedLocales = ({ locale } = {}) => {
  let locales = [];
  if (locale instanceof Array) {
    locales = locale;
    if (!locales.includes('all')) {
      return locale;
    }
  }
  if (typeof locale === 'string') {
    locales = locale.split(',');
    if (!locales.includes('all')) {
      return locale;
    }
  }
  return [];
};

const getAvailableLocales = async pluginOptions => {
  try {
    const { data } = await getClient(pluginOptions).query({ query: gql`query LocaleQuery { i18NLocales { data { attributes { code } } } } ` });
    return (data?.i18NLocales?.data || []).map(locale => locale.attributes.code);
  } catch (err) {
    return [];
  }
};

const getLocales = async pluginOptions => {
  const specified = getSpecifiedLocales(pluginOptions);
  const available = await getAvailableLocales(pluginOptions);
  if (specified?.length) {
    return specified.filter(locale => available.includes(locale));
  }
  if (available?.length) {
    return available;
  }
  return ['all'];
}

const getTypesMap = async pluginOptions => {
  const types = await getTypes(pluginOptions);
  return types.reduce((acc, type) => Object.assign(acc, { [type.name]: type }), {});
};

module.exports = {
  getClient,
  getLocales,
  getSchema,
  getTypes,
  getTypesMap,
};