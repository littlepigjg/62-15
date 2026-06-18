export interface LogLine {
  id: string;
  content: string;
  type: 'stdout' | 'stderr';
  lineNumber: number;
}

export interface ProcessedLogGroup {
  id: string;
  type: 'single' | 'duplicate' | 'json' | 'stacktrace' | 'regex';
  content: string;
  lines: LogLine[];
  collapsed: boolean;
  repeatCount?: number;
  formattedContent?: string;
  matchPattern?: string;
  stackPreview?: {
    head: string[];
    tail: string[];
    hiddenCount: number;
  };
}

export interface FoldPattern {
  id: string;
  name: string;
  pattern: string;
  enabled: boolean;
}

const STORAGE_KEY = 'smart_log_fold_state';
const PATTERNS_KEY = 'smart_log_patterns';

export const DEFAULT_FOLD_PATTERNS: FoldPattern[] = [
  { id: 'heartbeat', name: '心跳检测', pattern: '.*heartbeat.*|.*ping.*|.*alive.*', enabled: true },
  { id: 'timestamp', name: '时间戳重复', pattern: '^\\[?\\d{4}[-/]\\d{2}[-/]\\d{2}.\\d{2}:\\d{2}:\\d{2}.*', enabled: false },
  { id: 'debug', name: 'DEBUG级别日志', pattern: '.*DEBUG.*', enabled: false },
  { id: 'info', name: 'INFO级别日志', pattern: '.*INFO.*', enabled: false },
];

const STACKTRACE_HEAD_LINES = 3;
const STACKTRACE_TAIL_LINES = 2;
const MIN_DUPLICATE_COUNT = 2;

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};

export const isJSON = (str: string): boolean => {
  const trimmed = str.trim();
  if (!trimmed) return false;
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
};

export const formatJSON = (str: string): string => {
  try {
    const parsed = JSON.parse(str.trim());
    return JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
};

export const highlightJSON = (jsonStr: string): string => {
  try {
    const parsed = JSON.parse(jsonStr);
    const formatted = JSON.stringify(parsed, null, 2);
    return formatted
      .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
      .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
      .replace(/: (-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
      .replace(/: (null)/g, ': <span class="json-null">$1</span>');
  } catch {
    return escapeHtml(jsonStr);
  }
};

const escapeHtml = (str: string): string => {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

export const isStackTraceLine = (line: string): boolean => {
  const stackPatterns = [
    /^\s*at\s+.+\(.+\)$/,
    /^\s*at\s+.+:\d+:\d+$/,
    /^\s*File\s+".+",\s+line\s+\d+/,
    /^\s*Exception\s+in\s+thread\s+".+"/,
    /^Caused\s+by:\s+.+/,
    /^\s*\.\.\.\s+\d+\s+more$/,
  ];
  return stackPatterns.some(p => p.test(line));
};

export const isErrorLine = (line: string): boolean => {
  const errorPatterns = [
    /Error:/,
    /Exception:/,
    /Traceback\s+\(most\s+recent\s+call\s+last\):/,
    /FATAL/,
    /^[A-Z][a-zA-Z]*Error/,
    /^[A-Z][a-zA-Z]*Exception/,
  ];
  return errorPatterns.some(p => p.test(line));
};

export const matchFoldPatterns = (line: string, patterns: FoldPattern[]): string | null => {
  for (const p of patterns) {
    if (!p.enabled) continue;
    try {
      const regex = new RegExp(p.pattern, 'i');
      if (regex.test(line)) {
        return p.name;
      }
    } catch {
      continue;
    }
  }
  return null;
};

export const processLogs = (
  stdout: string,
  stderr: string,
  patterns: FoldPattern[] = DEFAULT_FOLD_PATTERNS,
  collapsedIds: Set<string> = new Set()
): ProcessedLogGroup[] => {
  const allLines: LogLine[] = [];
  let lineNum = 0;

  if (stdout) {
    stdout.split('\n').forEach(line => {
      allLines.push({
        id: `o-${lineNum}`,
        content: line,
        type: 'stdout',
        lineNumber: lineNum++,
      });
    });
  }

  if (stderr) {
    stderr.split('\n').forEach(line => {
      allLines.push({
        id: `e-${lineNum}`,
        content: line,
        type: 'stderr',
        lineNumber: lineNum++,
      });
    });
  }

  const groups: ProcessedLogGroup[] = [];
  let i = 0;

  while (i < allLines.length) {
    const currentLine = allLines[i];

    if (isJSON(currentLine.content)) {
      const formatted = formatJSON(currentLine.content);
      const highlighted = highlightJSON(currentLine.content);
      const groupId = `json-${generateId()}`;
      groups.push({
        id: groupId,
        type: 'json',
        content: currentLine.content,
        formattedContent: highlighted,
        lines: [currentLine],
        collapsed: collapsedIds.has(groupId),
      });
      i++;
      continue;
    }

    if (isErrorLine(currentLine.content) || isStackTraceLine(currentLine.content)) {
      const stackLines: LogLine[] = [currentLine];
      let j = i + 1;
      while (j < allLines.length && (isStackTraceLine(allLines[j].content) || allLines[j].content.trim() === '')) {
        if (allLines[j].content.trim() !== '') {
          stackLines.push(allLines[j]);
        }
        j++;
      }

      if (stackLines.length > STACKTRACE_HEAD_LINES + STACKTRACE_TAIL_LINES + 1) {
        const groupId = `stack-${generateId()}`;
        const head = stackLines.slice(0, STACKTRACE_HEAD_LINES).map(l => l.content);
        const tail = stackLines.slice(-STACKTRACE_TAIL_LINES).map(l => l.content);
        const hiddenCount = stackLines.length - STACKTRACE_HEAD_LINES - STACKTRACE_TAIL_LINES;

        groups.push({
          id: groupId,
          type: 'stacktrace',
          content: stackLines.map(l => l.content).join('\n'),
          lines: stackLines,
          collapsed: collapsedIds.has(groupId),
          stackPreview: { head, tail, hiddenCount },
        });
        i = j;
        continue;
      } else {
        stackLines.forEach(line => {
          groups.push({
            id: `single-${generateId()}`,
            type: 'single',
            content: line.content,
            lines: [line],
            collapsed: false,
          });
        });
        i = j;
        continue;
      }
    }

    const patternMatch = matchFoldPatterns(currentLine.content, patterns);
    if (patternMatch) {
      const matchedLines: LogLine[] = [currentLine];
      let j = i + 1;
      while (j < allLines.length && matchFoldPatterns(allLines[j].content, patterns) === patternMatch) {
        matchedLines.push(allLines[j]);
        j++;
      }

      if (matchedLines.length >= MIN_DUPLICATE_COUNT) {
        const groupId = `regex-${generateId()}`;
        groups.push({
          id: groupId,
          type: 'regex',
          content: currentLine.content,
          lines: matchedLines,
          collapsed: collapsedIds.has(groupId),
          repeatCount: matchedLines.length,
          matchPattern: patternMatch,
        });
        i = j;
        continue;
      }
    }

    const duplicateLines: LogLine[] = [currentLine];
    let j = i + 1;
    const normalizedCurrent = currentLine.content
      .replace(/\d{4}[-/]?\d{2}[-/]?\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d+)?/g, '[TIMESTAMP]')
      .replace(/\d+ms|\d+\.\d+s/g, '[DURATION]')
      .replace(/0x[0-9a-fA-F]+/g, '[HEX]')
      .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, '[IP]')
      .trim();

    while (j < allLines.length) {
      const nextLine = allLines[j];
      const normalizedNext = nextLine.content
        .replace(/\d{4}[-/]?\d{2}[-/]?\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d+)?/g, '[TIMESTAMP]')
        .replace(/\d+ms|\d+\.\d+s/g, '[DURATION]')
        .replace(/0x[0-9a-fA-F]+/g, '[HEX]')
        .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, '[IP]')
        .trim();

      if (normalizedNext === normalizedCurrent && normalizedCurrent.length > 0) {
        duplicateLines.push(nextLine);
        j++;
      } else {
        break;
      }
    }

    if (duplicateLines.length >= MIN_DUPLICATE_COUNT) {
      const groupId = `dup-${generateId()}`;
      groups.push({
        id: groupId,
        type: 'duplicate',
        content: currentLine.content,
        lines: duplicateLines,
        collapsed: collapsedIds.has(groupId),
        repeatCount: duplicateLines.length,
      });
      i = j;
    } else {
      groups.push({
        id: `single-${generateId()}`,
        type: 'single',
        content: currentLine.content,
        lines: [currentLine],
        collapsed: false,
      });
      i++;
    }
  }

  return groups;
};

export const saveFoldState = (key: string, collapsedIds: string[]): void => {
  try {
    const storage = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    storage[key] = collapsedIds;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
  } catch {}
};

export const loadFoldState = (key: string): string[] => {
  try {
    const storage = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return storage[key] || [];
  } catch {
    return [];
  }
};

export const saveFoldPatterns = (patterns: FoldPattern[]): void => {
  try {
    localStorage.setItem(PATTERNS_KEY, JSON.stringify(patterns));
  } catch {}
};

export const loadFoldPatterns = (): FoldPattern[] => {
  try {
    const stored = localStorage.getItem(PATTERNS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {}
  return [...DEFAULT_FOLD_PATTERNS];
};
