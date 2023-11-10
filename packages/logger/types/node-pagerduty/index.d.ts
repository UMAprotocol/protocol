declare module "node-pagerduty" {
    interface Incidents {
        createIncident: (from: string, payload: { [key: string]: any }) => void; 
    }
    export default class Client {
        constructor(apiToken: string, tokenType?: string, options?: any);
        public incidents: Incidents;
    }
}