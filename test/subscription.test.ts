import Fastify from "fastify";
import gql from "graphql-tag";
import mercurius from "mercurius";
import tap from "tap";

import { createMercuriusTestClient } from "../src";

const app = Fastify({});

const schema = `
  type Notification {
    id: ID!
    message: String
  }

  type Query {
    notifications: [Notification]
  }

  type Mutation {
    addNotification(message: String): Notification
  }

  type Subscription {
    notificationAdded: Notification
  }
`;

let idCount = 1;
const notifications = [
  {
    id: idCount,
    message: "Notification message",
  },
];

const resolvers = {
  Query: {
    notifications: () => notifications,
  },
  Mutation: {
    addNotification: async (_: unknown, { message }: any, { pubsub }: any) => {
      const id = idCount++;
      const notification = {
        id,
        message,
      };
      notifications.push(notification);
      await pubsub.publish({
        topic: "NOTIFICATION_ADDED",
        payload: {
          notificationAdded: notification,
        },
      });

      return notification;
    },
  },
  Subscription: {
    notificationAdded: {
      // You can also subscribe to multiple topics at once using an array like this:
      //  pubsub.subscribe(['TOPIC1', 'TOPIC2'])
      subscribe: async (root: any, args: any, { pubsub }: any) => {
        return await pubsub.subscribe("NOTIFICATION_ADDED");
      },
    },
  },
};

app.register(mercurius, {
  schema,
  resolvers,
  subscription: {
    async onConnect(_data) {
      // console.log(_data)
      return {};
    },
    verifyClient(_info, next) {
      // console.log(_info.req.headers);
      next(true);
    },
  },
});

tap
  .test("subscriptions with new listen", (t) => {
    t.plan(1);

    const client = createMercuriusTestClient(app);

    const subscription = client
      .subscribe({
        query: `
        subscription {
          notificationAdded {
            id
            message
          }
        }
        `,
        onData: (data) => {
          t.equivalent(data, {
            notificationAdded: {
              id: 1,
              message: "hello world",
            },
          });
          subscription.then((sub) => {
            sub.unsubscribe();
          });
        },
        initPayload: {
          a: 123,
        },
        cookies: {
          a: "1",
          b: "2",
        },
        headers: {
          c: "3",
          d: "4",
        },
      })
      .then((sub) => {
        client
          .mutate(
            `
   mutation {
       addNotification(message: "hello world") {
        id
        message
    }
   }
   `
          )
          .catch(console.error);

        return sub;
      });
  })
  .then(() => {
    tap
      .test("subscriptions with reuse listen", (t) => {
        t.plan(1);

        const client = createMercuriusTestClient(app);

        const subscription = client
          .subscribe({
            query: gql`
              subscription {
                notificationAdded {
                  id
                  message
                }
              }
            `,
            onData: (data) => {
              t.equivalent(data, {
                notificationAdded: {
                  id: 2,
                  message: "hello world",
                },
              });
              subscription.then((sub) => {
                sub.unsubscribe();
              });
            },
          })
          .then((sub) => {
            client
              .mutate(
                `
     mutation {
         addNotification(message: "hello world") {
          id
          message
      }
     }
     `
              )

              .catch(console.error);

            return sub;
          });
      })
      .then(() => {
        tap
          .test("error handling", (t) => {
            t.plan(2);
            const client = createMercuriusTestClient(app);
            t.rejects(
              client.subscribe({
                query: {} as any,
                onData() {},
              }),
              Error("Invalid AST Node")
            );

            const errorClient = createMercuriusTestClient({} as any);

            t.rejects(
              errorClient.subscribe({
                query: "",
                onData(_data) {},
              }),
              Error("Cannot read property")
            );
          })
          .then(() => {
            app.close();
          });
      });
  });
