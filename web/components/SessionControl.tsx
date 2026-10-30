import { api } from "../api";
import { useStore } from "../store";

export function SessionControl() {
  const { session, sessionChanges, mutate, setNotice } = useStore();
  if (!session) {
    return (
      <button
        className="btn ghost"
        onClick={() => {
          const title = prompt("What are you exploring in this session?");
          if (title !== null) void mutate(() => api.startSession(title));
        }}
      >
        Start session
      </button>
    );
  }
  return (
    <div className="session">
      <span className="live-dot" aria-hidden />
      <span className="session-title">{session.title}</span>
      <span className="muted small">{sessionChanges} changes</span>
      <button
        className="btn ghost small"
        onClick={async () => {
          const ended = await mutate(() => api.endSession(session.id));
          if (ended) setNotice(`Session ended: ${ended.summary}`);
        }}
      >
        End
      </button>
    </div>
  );
}
