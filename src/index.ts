import { Client, IFrame, IMessage } from '@stomp/stompjs';
import SockJS, { CloseEvent } from 'sockjs-client';
import { call, fork, put, all, take, cancelled } from 'redux-saga/effects';
import {
  CallbackConfigurer,
  createCallbackReactingSaga,
  createCallbackSaga,
} from '@animando/redux-saga-callback';
import { createAction } from 'redux-actions';

const verboseLogger =  (str: string) => console.log(`::: ${str}`);
const nilLogger =  (_str: string) => null;

const createStompClient = (config: StompConnectionConfig) => {
    const sock = () => new SockJS(config.sockJsEndpoint);
    const client = new Client({
      webSocketFactory: sock,
      debug: config.verboseLogging ? verboseLogger : nilLogger,
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000
    });

    return client;
}

export interface StompConnectionConfig {
  sockJsEndpoint: string;
  verboseLogging: boolean;
}
export interface PromiseFactory<T> {
  getPromise: () => Promise<T>
}

export type CreateStompClientCallbackConfigurer = (client: Client) => CallbackConfigurer<IFrame>;
export type CreateStompClientDisconnectCallbackConfigurer = (client: Client) => CallbackConfigurer<CloseEvent>;

export type CreateSubscriptionCallbackConfigurer = (subscription: StompSubscription<any>, client: Client) => CallbackConfigurer<IMessage>;

export interface StompSubscription<P> {
  path: string;
  routine: any;
  convertPayload: (payload: any) => P;
}

export interface StompPublishApi {
  path: string;
  routine: any;
}
export interface StompApiDefinition {
  subscriptions: ReadonlyArray<StompSubscription<any>>;
  publishDefinitions: ReadonlyArray<StompPublishApi>;
}

const CONNECT_ACTION = '@stomp/CONNECTED';
const DISCONNECT_ACTION = '@stomp/DISCONNECTED';
const stompConnected = createAction(CONNECT_ACTION);
const stompDisconnected = createAction(DISCONNECT_ACTION);

const createStompClientConnectionCallbackConfigurer: CreateStompClientCallbackConfigurer = (client) => (res) => {
    client.onConnect = res;
}

const createStompClientDisconnectionCallbackConfigurer: CreateStompClientDisconnectCallbackConfigurer = (client) => (res) => {
    client.onWebSocketClose = res;
}

const createSubscriptionCallbackConfigurer: CreateSubscriptionCallbackConfigurer =
 (subscription: StompSubscription<any>, client: Client) => (res) =>
  client.subscribe(subscription.path, (payload) => res(payload));

const createSubscriptionSaga = (subscription: StompSubscription<any>, client: Client) => {
  function* handleSubscribedMessage(action: IMessage) {
    const converted = yield call(subscription.convertPayload, action.body);

    yield put(subscription.routine.success({
      body: converted,
      headers: action.headers,
    }));
  }

  const subscriptionCallbackConfigurer: CallbackConfigurer<IMessage> = createSubscriptionCallbackConfigurer(subscription, client);
  const subscriptionSaga = createCallbackReactingSaga(
    `subscription: ${subscription.path}`,
    subscriptionCallbackConfigurer,
    subscription.routine.trigger,
    handleSubscribedMessage,
    true,
    'unsubscribe'
  );

  return function*() {
    try {
      yield fork(subscriptionSaga);
    }
    finally {
      if (yield cancelled()) {
        console.log(`subscription saga for ${subscription.path} was cancelled`);
      }
    }
  }
}

const createPublisher = (client: Client) => (destination: string, payload: any) => {
  client.publish({
    destination,
    body: JSON.stringify(payload)
  });
}

const createPublishSaga = (api: StompPublishApi, client: Client) => {
  const doPublish = createPublisher(client);
  return function*() {
    try {
      console.log(`publish (${api.path}) saga started`);
      while (true) {
        const { payload } = yield take(api.routine.TRIGGER);
        yield call(doPublish, api.path, payload);
      }
    } finally {
      if (yield(cancelled())) {
        console.log(`publish (${api.path}) saga cancelled`);
      }
    }
  }
}

const createOnConnectedSaga = (client: Client, api: StompApiDefinition) => {
  const stompClientDisconnectionCallbackConfigurer = createStompClientDisconnectionCallbackConfigurer(client);
  const disconnectSaga = createCallbackSaga('stompOnDisconnect', stompClientDisconnectionCallbackConfigurer, stompDisconnected);

  return function*() {
    yield fork(disconnectSaga);
    yield all([
      ...api.subscriptions.map(s => createSubscriptionSaga(s, client)()),
      ...api.publishDefinitions.map(p => createPublishSaga(p, client)())
    ]);
  }
}

export const createWsApiSaga = (config: StompConnectionConfig, api: StompApiDefinition) => {

  const client = createStompClient(config);
  const stompClientConnectionCallbackConfigurer = createStompClientConnectionCallbackConfigurer(client);
  const stompConnectedSaga = createCallbackReactingSaga(
    'stompOnConnect',
    stompClientConnectionCallbackConfigurer,
    stompConnected,
    createOnConnectedSaga(client, api),
    true,
    DISCONNECT_ACTION);

  client.activate();

  return function* wsApiSaga() {
    try {
      yield fork(stompConnectedSaga);
    }
    finally {
      const wasCancelled = yield cancelled();
      if (wasCancelled) {
        console.log('wsApiSaga ended gracefully')
      }
    }
  }
}
