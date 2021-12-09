const { ApolloClient, InMemoryCache, HttpLink } = require("@apollo/client")
const fetch = require("cross-fetch");

const clients = {};

const client = apiURL => {
  if (!clients[apiURL]) {
    clients[apiURL] = new ApolloClient({
      link: new HttpLink({
        uri: `${apiURL}/graphql`,
        fetch,
      }),
      cache: new InMemoryCache(),
    });
  }
  return clients[apiURL];
};

module.exports = client;