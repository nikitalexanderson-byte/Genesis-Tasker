/** Existing message transport is a separate protocol. These routes are never
 * repurposed as shared-record CRUD or a vault-key recovery capability. */
export function isIndependentMessagingPath(path:string){
 const route=path.split('?',1)[0];return /^\/shared\/(?:messenger|messaging|private-conversations)(?:\/|$)/.test(route)
  ||/^\/shared\/spaces\/[A-Za-z0-9_-]{1,160}\/(?:participants|private-conversations)$/.test(route);
}
