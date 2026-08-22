import { useEffect, useMemo, useState } from "react";
import {
  appServerClient,
  type RuntimeServerRequest,
} from "../runtime/appServerClient";
import "./runtimeInputDock.css";

const TOOL_USER_INPUT = "item/tool/requestUserInput";
const SERVER_REQUEST_RESOLVED = "serverRequest/resolved";

interface RuntimeInputOption {
  label: string;
  description: string;
}

interface RuntimeInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: RuntimeInputOption[] | null;
}

interface RuntimeInputRequest {
  request: RuntimeServerRequest;
  threadId: string;
  turnId: string;
  itemId: string;
  questions: RuntimeInputQuestion[];
  autoResolutionMs: number | null;
}

export function RuntimeInputDock() {
  const [queue, setQueue] = useState<RuntimeInputRequest[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offRequest = appServerClient.onServerRequest((request) => {
      const inputRequest = normalizeInputRequest(request);
      if (!inputRequest) return;
      setQueue((current) => {
        if (current.some((entry) => entry.request.id === request.id)) return current;
        return [...current, inputRequest];
      });
    });
    const offNotification = appServerClient.onNotification((notification) => {
      if (notification.method !== SERVER_REQUEST_RESOLVED || !isRecord(notification.params)) {
        return;
      }
      const requestId = notification.params.requestId;
      if (!isRequestId(requestId)) return;
      setQueue((current) =>
        current.filter((entry) => entry.request.id !== requestId),
      );
    });

    return () => {
      offRequest();
      offNotification();
    };
  }, []);

  const current = queue[0] ?? null;
  const canSubmit = useMemo(
    () => current !== null && current.questions.every((question) => Boolean(answers[question.id]?.trim())),
    [answers, current],
  );

  useEffect(() => {
    setAnswers({});
    setError(null);
  }, [current?.request.id]);

  if (!current) return null;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    const responseAnswers: Record<string, { answers: string[] }> = {};
    for (const question of current.questions) {
      const answer = answers[question.id]?.trim();
      if (!answer) continue;
      responseAnswers[question.id] = { answers: [answer] };
    }

    try {
      await appServerClient.respondToServerRequest(current.request.id, {
        answers: responseAnswers,
      });
      setQueue((entries) =>
        entries.filter((entry) => entry.request.id !== current.request.id),
      );
    } catch (responseError) {
      setError(
        responseError instanceof Error ? responseError.message : String(responseError),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="runtime-input-dock" role="dialog" aria-live="polite">
      <header>
        <div>
          <span>Input requested</span>
          <strong>{current.questions[0]?.header || "Syndrid needs input"}</strong>
        </div>
        {queue.length > 1 && <em>{queue.length} pending</em>}
      </header>

      <div className="runtime-input-body">
        {current.questions.map((question) => (
          <fieldset key={question.id}>
            <legend>{question.header}</legend>
            <p>{question.question}</p>
            {question.options && question.options.length > 0 && (
              <div className="runtime-input-options">
                {question.options.map((option) => (
                  <button
                    className={answers[question.id] === option.label ? "selected" : ""}
                    key={option.label}
                    onClick={() =>
                      setAnswers((currentAnswers) => ({
                        ...currentAnswers,
                        [question.id]: option.label,
                      }))
                    }
                    title={option.description}
                    type="button"
                  >
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
            )}
            {(question.options === null || question.isOther) && (
              <input
                autoComplete="off"
                onChange={(event) =>
                  setAnswers((currentAnswers) => ({
                    ...currentAnswers,
                    [question.id]: event.target.value,
                  }))
                }
                placeholder={question.isOther ? "Or enter another answer" : "Enter your answer"}
                type={question.isSecret ? "password" : "text"}
                value={answers[question.id] ?? ""}
              />
            )}
          </fieldset>
        ))}
        {error && <p className="runtime-input-error">{error}</p>}
      </div>

      <footer>
        <span>
          thread {current.threadId.slice(0, 8)} · turn {current.turnId.slice(0, 8)}
        </span>
        <button disabled={!canSubmit || submitting} onClick={() => void submit()} type="button">
          {submitting ? "Sending…" : "Submit"}
        </button>
      </footer>
    </section>
  );
}

function normalizeInputRequest(request: RuntimeServerRequest): RuntimeInputRequest | null {
  if (request.method !== TOOL_USER_INPUT || !isRecord(request.params)) return null;

  const threadId = stringValue(request.params.threadId);
  const turnId = stringValue(request.params.turnId);
  const itemId = stringValue(request.params.itemId);
  if (!threadId || !turnId || !itemId || !Array.isArray(request.params.questions)) {
    return null;
  }

  const questions = request.params.questions
    .map(normalizeQuestion)
    .filter((question): question is RuntimeInputQuestion => question !== null);
  if (questions.length === 0) return null;

  return {
    request,
    threadId,
    turnId,
    itemId,
    questions,
    autoResolutionMs:
      typeof request.params.autoResolutionMs === "number"
        ? request.params.autoResolutionMs
        : null,
  };
}

function normalizeQuestion(value: unknown): RuntimeInputQuestion | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const header = stringValue(value.header);
  const question = stringValue(value.question);
  if (!id || !header || !question) return null;

  const options = Array.isArray(value.options)
    ? value.options.map(normalizeOption).filter((option): option is RuntimeInputOption => option !== null)
    : null;

  return {
    id,
    header,
    question,
    isOther: value.isOther === true,
    isSecret: value.isSecret === true,
    options,
  };
}

function normalizeOption(value: unknown): RuntimeInputOption | null {
  if (!isRecord(value)) return null;
  const label = stringValue(value.label);
  const description = stringValue(value.description);
  if (!label || description === null) return null;
  return { label, description };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestId(value: unknown): value is RuntimeServerRequest["id"] {
  return typeof value === "string" || typeof value === "number";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
