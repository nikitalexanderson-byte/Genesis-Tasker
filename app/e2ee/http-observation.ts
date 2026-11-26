/** Body bytes as exposed by fetch/platform HTTP, before UTF8 or JSON. Platform
 * TLS/content-encoding decoding is outside this application-level observation.
 * A memory implementation is not proof of durable custody; production callers
 * must supply the protected journal and verify its exact completion binding. */
export type E2eeHttpBodyObservation={
 begin(metadata:Readonly<{path:string;status:number;contentType:string|null;contentLength:string|null}>):Promise<void>;
 /** At most64KiB. The loan expires on return and cannot alter parser input. */
 append(bytes:Uint8Array):Promise<void>;
 finish():Promise<void>;
 /** Idempotent live-capability revocation. Never delete a durable partial attempt. */
 close():void;
};
export type E2eeHttpObservation=E2eeHttpBodyObservation&{
 /** Called against the exact immutable transmitted request BEFORE fetch. */
 prepare(request:Readonly<{path:string;method:string;body:string|null}>):Promise<void>;
};
