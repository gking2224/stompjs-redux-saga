# stompjs-redux-saga

This library makes it easy to configure stompjs client connection integrated with redux saga.

Under the hood it uses lower-level callback/saga integration library [@animando/redux-saga-callback](https://www.npmjs.com/package/@animando/redux-saga-callback).

## Usage

Define your api and associated routines (see [redux-saga-routines](https://www.npmjs.com/package/redux-saga-routines)):

```
export const publishRoutine = createRoutine('PUBLISH_SOMETHING');
export const incomingMessageRoutine = createRoutine('INCOMING_MESSAGE');

export const subscriptions = [
  {
    path: '/topic/incoming',
    routine: incomingMessageRoutine,
    convertPayload: (body) => JSON.parse(body),
  },
];

export const testPublishDefinitions = [
  {
    path: '/app/publish_something',
    routine: publishRoutine,
  },
];
```

Finally, provide details of your websocket endpoint, and run the saga:

```
import { createWsApiSaga } from '@animando/stompjs-redux-saga';
const stompConnectionConfig = {
  sockJsEndpoint: <endpoint>,
}

const wsSaga = createWsApiSaga(stompConnectionConfig, stompApiDefinition)

function* rootSaga() {
  yield fork(wsSaga);
}
```

Now you just dispatch publish actions:
```
publishRoutine.trigger('my payload');
```

and handle incoming subscription notifications as actions in your reducer like normal:

```
const reducer = (state = {}, {type, payload}) => {
  switch (type) {
    case: incomingMessageRoutine.SUCCESS:
      return {
        ...state,
        incomingMessage: payload,
      }

  }
}
```
