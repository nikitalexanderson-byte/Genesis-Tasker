"use client";
import { IconActionButton } from "./IconActionButton";
import { collaborationText } from "./collaboration-copy";

export type PrivateMessagePeer = { spaceId: string; userId: string; displayName: string };
export const PRIVATE_MESSAGE_OPEN = "genesis:private-message-open";

/** Uses the same Google account and opens an ordinary account-wide conversation. */
export function SharedMemberMessageButton({ actorId, peer, language, onOpen }: {
  actorId: string; peer: PrivateMessagePeer; language: string; onOpen?: () => void;
}) {
  if (peer.userId === actorId) return null;
  return <IconActionButton icon="mail" label={`${collaborationText("write", language)} · ${peer.displayName}`}
    className="shared-member-message" data-member-message={peer.userId} aria-haspopup="dialog"
    onClick={() => { onOpen?.(); window.dispatchEvent(new CustomEvent('genesis:messenger-peer', { detail: {userId:peer.userId} })); }} />;
}
