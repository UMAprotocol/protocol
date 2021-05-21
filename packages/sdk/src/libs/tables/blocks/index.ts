import JsMap from './js-map'

export {JsMap}
export type JsMap = ReturnType<typeof JsMap>

export type Data = {
  id?: number;
  number: number;
  hash: string;
  timestamp: number;
};

