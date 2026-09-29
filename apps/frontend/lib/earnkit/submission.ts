import { z } from 'zod';
import type { ProjectField, SubmissionRequirement } from './program-file';

export const ProjectInfo = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    repo_url: z.string().optional(),
    live_url: z.string().optional(),
    demo_url: z.string().optional(),
    token_url: z.string().optional(),
  })
  .strict();
export type ProjectInfo = z.infer<typeof ProjectInfo>;

export type KnownInfo = {
  project?: ProjectInfo;
  /** Answers to program questions, by submission requirement key. */
  answers?: Record<string, string>;
};

const isUrl = (v: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

function problemWith(req: SubmissionRequirement, value: string): string | null {
  if (req.type === 'url' && !isUrl(value)) return 'Not a valid http(s) link.';
  if (req.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return 'Not a valid email.';
  if (req.type === 'choice' && req.options && !req.options.includes(value)) {
    return `Must be one of: ${req.options.join(', ')}.`;
  }
  return null;
}

/**
 * Compares what the agent knows against the program's real submission
 * requirements. Pure: never invents values, only reports what is filled,
 * what is missing, and who should supply each missing piece.
 */
export function prepareSubmission(
  requirements: SubmissionRequirement[],
  known: KnownInfo,
) {
  const answers = known.answers ?? {};
  const project = known.project ?? {};

  const complete: {
    key: string;
    label: string;
    value: string;
    filled_from: 'answer' | ProjectField;
  }[] = [];
  const missing: {
    key: string;
    label: string;
    type: SubmissionRequirement['type'];
    required: boolean;
    description?: string;
    options?: string[];
    problem?: string;
    next_step: string;
  }[] = [];

  for (const req of requirements) {
    const fromAnswer = answers[req.key]?.trim();
    const fromProject = req.project_field
      ? project[req.project_field]?.trim()
      : undefined;
    const value = fromAnswer || fromProject;
    const problem = value ? problemWith(req, value) : null;

    if (value && !problem) {
      complete.push({
        key: req.key,
        label: req.label,
        value,
        filled_from: fromAnswer ? 'answer' : req.project_field!,
      });
      continue;
    }

    missing.push({
      key: req.key,
      label: req.label,
      type: req.type,
      required: req.required,
      ...(req.description && { description: req.description }),
      ...(req.options && { options: req.options }),
      ...(problem && { problem }),
      next_step:
        req.from === 'builder'
          ? 'Use what you know for sure about the builder (e.g. their GitHub or X); otherwise ask. Never guess.'
          : 'Draft this from the project, then confirm it with the builder.',
    });
  }

  const knownKeys = new Set(requirements.map((r) => r.key));
  const unused_answers = Object.keys(answers).filter((k) => !knownKeys.has(k));

  return {
    ready: missing.every((m) => !m.required),
    complete,
    missing,
    ...(unused_answers.length > 0 && { unused_answers }),
  };
}
