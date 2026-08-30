import { useCallback, useEffect, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import { notifications } from "../runtime/protocol";
import "./conversationFollowBridge.css";

const FOLLOW_THRESHOLD_PX = 96;

export function ConversationFollowBridge() {
  const [unreadLiveOutput, setUnreadLiveOutput] = useState(false);
  const followsLatestRef = useRef(true);
  const frameRef = useRef<number | null>(null);
  const selectedThreadIdRef = useRef(
    appServerClient.getWorkspaceSnapshot()?.threadId ?? null,
  );

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const conversation = conversationElement();
    if (!conversation) return;

    conversation.scrollTo({
      top: conversation.scrollHeight,
      behavior,
    });
    followsLatestRef.current = true;
    setUnreadLiveOutput(false);
  }, []);

  useEffect(() => {
    const conversation = conversationElement();
    if (!conversation) return;

    const updateFollowState = () => {
      const remaining =
        conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight;
      const followsLatest = remaining <= FOLLOW_THRESHOLD_PX;
      followsLatestRef.current = followsLatest;
      if (followsLatest) setUnreadLiveOutput(false);
    };

    updateFollowState();
    conversation.addEventListener("scroll", updateFollowState, { passive: true });
    return () => conversation.removeEventListener("scroll", updateFollowState);
  }, []);

  useEffect(() => {
    const offWorkspaceChange = appServerClient.onWorkspaceChange(() => {
      selectedThreadIdRef.current =
        appServerClient.getWorkspaceSnapshot()?.threadId ?? null;
      followsLatestRef.current = true;
      setUnreadLiveOutput(false);

      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        scrollToLatest("auto");
      });
    });

    const offNotification = appServerClient.onNotification((notification) => {
      if (notification.method !== notifications.agentMessageDelta) return;

      const notificationThreadId = threadIdFromParams(notification.params);
      if (
        notificationThreadId === null ||
        notificationThreadId !== selectedThreadIdRef.current
      ) {
        return;
      }

      if (!followsLatestRef.current) {
        setUnreadLiveOutput(true);
        return;
      }

      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        scrollToLatest("auto");
      });
    });

    return () => {
      offWorkspaceChange();
      offNotification();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [scrollToLatest]);

  if (!unreadLiveOutput) return null;

  return (
    <button
      className="conversation-follow-button"
      onClick={() =>
        scrollToLatest(prefersReducedMotion() ? "auto" : "smooth")
      }
      type="button"
    >
      <span aria-hidden="true">↓</span>
      Latest output
    </button>
  );
}

function conversationElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".conversation");
}

function threadIdFromParams(params: unknown): string | null {
  if (params === null || typeof params !== "object") return null;
  if (!("threadId" in params)) return null;
  const threadId = (params as { threadId?: unknown }).threadId;
  return typeof threadId === "string" ? threadId : null;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
