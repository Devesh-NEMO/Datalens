/**
 * Single source of truth for design tokens, file rules, limits, and user-facing copy.
 *
 * Adding a file format is a one-line change: flip `enabled` on its group in
 * SUPPORTED_FILE_TYPES (once the backend can read it) and the dropzone accept
 * list, helper text, and validation messages all follow automatically.
 */

/* -------------------------------------------------------------------------- */
/* Design tokens                                                              */
/* -------------------------------------------------------------------------- */

export const THEME_COLORS = {
  dark: {
    page: '#0E0E10',
    text: '#ECE9E2',
    mutedText: '#8B877E',
    rule: '#2A2926',
    classA: '#7EE0B0',
    classB: '#F2C66B',
    classC: '#F08A7E',
    accent: '#ECE9E2',
  },
  light: {
    page: '#F7F4EC',
    text: '#1A1916',
    mutedText: '#6B675E',
    rule: '#DCD7CA',
    classA: '#2E9E6E',
    classB: '#B98A1E',
    classC: '#C4584B',
    accent: '#1A1916',
  },
} as const;

export type ThemeName = keyof typeof THEME_COLORS;
export type AbcClass = 'A' | 'B' | 'C';

/**
 * Narrow the generated `abc_class: string` to the three real classes.
 *
 * The API types the field as a plain string, so something has to decide what an
 * unexpected value means. A and B are the classes a reader trusts most, so
 * guessing one of those would overstate the finding; C is the conservative
 * default. Accepts lowercase so a differently-cased backend still reads right.
 */
export function asAbcClass(value: string | null | undefined): AbcClass {
  const upper = String(value ?? '').trim().toUpperCase();
  if (upper === 'A' || upper === 'B' || upper === 'C') return upper;
  return 'C';
}

/** Hex values, for tests and for non-CSS consumers (charts, canvas). */
export const ABC_CLASS_COLORS: Record<AbcClass, Record<ThemeName, string>> = {
  A: { dark: '#7EE0B0', light: '#2E9E6E' },
  B: { dark: '#F2C66B', light: '#B98A1E' },
  C: { dark: '#F08A7E', light: '#C4584B' },
};

/**
 * CSS custom-property references. Components use these so a theme switch is a
 * class swap with no re-render and no hard-coded hex in JSX.
 */
export const ABC_CLASS_VARS: Record<AbcClass, string> = {
  A: 'var(--color-class-a)',
  B: 'var(--color-class-b)',
  C: 'var(--color-class-c)',
};

export const RULES_VARS = {
  page: 'var(--color-page)',
  text: 'var(--color-text)',
  mutedText: 'var(--color-muted-text)',
  rule: 'var(--color-rule)',
  accent: 'var(--color-accent)',
} as const;

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

export const TAGLINE = 'Find the 20% that drives your 80%';

/**
 * Theme preference key. Lives here rather than in useTheme.tsx so the
 * server-rendered layout can inline it in the pre-paint script: importing a
 * value from a 'use client' module into a server component makes the value a
 * client reference, which serialises to a throwing stub inside inline scripts.
 */
export const THEME_STORAGE_KEY = 'datalens-theme';

export const EMPTY_STATE_DESCRIPTION =
  'Upload a sales file to see your ABC analysis, product ranking, and growth trends.';

/* -------------------------------------------------------------------------- */
/* File rules                                                                 */
/* -------------------------------------------------------------------------- */

/** Keeps the dropzone honest: the backend decides, but flag it here when it drifts. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/** Client-side upload ceiling. Kept at or below the backend's MAX_UPLOAD_MB. */
export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface FileTypeGroup {
  readonly id: string;
  readonly label: string;
  readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[];
  /**
   * True only when the backend can actually read this group today. Disabled
   * groups stay in this file as documentation of what is coming, and the
   * dropzone rejects them with a clear message rather than failing server-side.
   */
  readonly enabled: boolean;
}

export const SUPPORTED_FILE_TYPES: readonly FileTypeGroup[] = [
  {
    id: 'delimited',
    label: 'Delimited text',
    extensions: ['.csv', '.tsv', '.txt', '.tab'],
    mimeTypes: ['text/csv', 'text/tab-separated-values', 'text/plain'],
    enabled: true,
  },
  {
    id: 'spreadsheets',
    label: 'Spreadsheets',
    extensions: ['.xlsx', '.xlsm', '.xls', '.xlsb', '.ods'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel.sheet.macroEnabled.12',
      'application/vnd.ms-excel',
      'application/vnd.oasis.opendocument.spreadsheet',
    ],
    // The backend reads .xlsx / .xlsm / .xls today.
    enabled: false,
  },
  {
    id: 'json',
    label: 'JSON',
    extensions: ['.json', '.ndjson', '.jsonl'],
    mimeTypes: ['application/json', 'application/x-ndjson'],
    enabled: false,
  },
  {
    id: 'columnar',
    label: 'Columnar',
    extensions: ['.parquet', '.feather', '.arrow', '.orc'],
    mimeTypes: ['application/vnd.apache.parquet', 'application/arrow', 'application/x-orc'],
    enabled: false,
  },
  {
    id: 'structured-text',
    label: 'Structured text',
    extensions: ['.xml', '.html', '.yaml', '.yml'],
    mimeTypes: ['application/xml', 'text/xml', 'text/html', 'application/yaml', 'text/yaml'],
    enabled: false,
  },
  {
    id: 'databases',
    label: 'Database files',
    extensions: ['.sqlite', '.sqlite3', '.db'],
    mimeTypes: ['application/vnd.sqlite3', 'application/x-sqlite3'],
    enabled: false,
  },
  {
    id: 'statistical',
    label: 'Statistical',
    extensions: ['.dta', '.sav', '.sas7bdat'],
    mimeTypes: ['application/x-stata-dta', 'application/x-spss-sav'],
    enabled: false,
  },
  {
    id: 'wrappers',
    label: 'Archives',
    extensions: ['.gz', '.zip'],
    mimeTypes: ['application/gzip', 'application/zip', 'application/x-gzip'],
    enabled: false,
  },
] as const;

/** Groups the dropzone will actually accept. */
export const ENABLED_FILE_TYPE_GROUPS = SUPPORTED_FILE_TYPES.filter((g) => g.enabled);

/** Every extension the backend currently reads, lower-cased with a leading dot. */
export const SUPPORTED_EXTENSIONS: readonly string[] = ENABLED_FILE_TYPE_GROUPS.flatMap((g) =>
  g.extensions.map((e) => e.toLowerCase())
);

/** react-dropzone `accept` map: mime type -> extensions. */
export const DROPZONE_ACCEPT: Record<string, string[]> = Object.fromEntries(
  ENABLED_FILE_TYPE_GROUPS.flatMap((g) =>
    g.mimeTypes.map((mime) => [mime, [...g.extensions]])
  )
);

/** A short "CSV · up to 10 MB" line for the dropzone. */
export const ACCEPTED_FORMATS_SUMMARY = ENABLED_FILE_TYPE_GROUPS.map((g) =>
  g.extensions.map((e) => e.replace('.', '').toUpperCase()).join(' / ')
).join(' · ');

/**
 * Copy for rejections, keyed by case. The dropzone picks the first match, so
 * order matters: specific cases first, unknown last.
 */
export const REJECTION_COPY: readonly {
  readonly test: (extension: string) => boolean;
  readonly message: string;
  readonly hint: string;
}[] = [
  {
    test: (e) => ['.sql', '.dump', '.ddl'].includes(e),
    message: "Datalens can't read SQL dump files.",
    hint: 'Export your table or query result as CSV, Excel, or JSON from your database tool, then upload that. SQLite files (.sqlite, .db) can be uploaded directly.',
  },
  {
    test: (e) => ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff'].includes(e),
    message: 'Datalens reads tables, not documents.',
    hint: 'Export the data as CSV or Excel first.',
  },
  {
    test: (e) =>
      ['.pkl', '.pickle', '.npy', '.npz', '.pt', '.pth', '.onnx', '.pb', '.joblib', '.dll', '.so', '.dylib', '.exe', '.bin', '.sh', '.bat', '.cmd', '.ps1', '.js', '.py', '.jar'].includes(e),
    message: "This file type isn't supported for safety reasons.",
    hint: 'Export your data as CSV or Excel, or as one of the formats listed below.',
  },
  {
    test: (e) => ['.doc', '.docx', '.ppt', '.pptx', '.odt', '.rtf'].includes(e),
    message: 'Datalens reads tables, not documents.',
    hint: 'Export the data as a spreadsheet (.xlsx or .csv) first.',
  },
  {
    test: (e) => SUPPORTED_EXTENSIONS.includes(e),
    message: 'This format is on the way but the backend cannot read it yet.',
    hint: 'For now, upload CSV. Supported today: CSV.',
  },
  {
    test: () => true,
    message: 'Unknown file type.',
    hint: 'Supported formats: CSV. Convert your file to CSV, or Excel (.xlsx, .xls), and try again.',
  },
] as const;

export const SIZE_LIMIT_MESSAGE =
  `That file is larger than ${MAX_FILE_SIZE_MB} MB. Please upload a smaller file.`;

export const MULTIPLE_FILES_MESSAGE = 'Please upload a single file.';

/* -------------------------------------------------------------------------- */
/* Database help                                                              */
/* -------------------------------------------------------------------------- */

export const DATABASE_HELP = {
  title: 'Working with a database?',
  intro:
    'Datalens reads files, not live connections. Export a query result to CSV, then upload the CSV.',
  steps: [
    {
      tool: 'Any tool (DBeaver, pgAdmin, MySQL Workbench, phpMyAdmin)',
      steps: ['Run your query.', 'Export the result grid to CSV.', 'Upload the CSV here.'],
    },
    {
      tool: 'Postgres CLI',
      steps: [
        "Run: \\copy (SELECT ...) TO 'out.csv' CSV HEADER",
        'Upload out.csv here.',
      ],
    },
    {
      tool: 'MySQL Workbench',
      steps: ['Run your query.', 'Right-click the result grid.', 'Export to CSV, then upload it.'],
    },
    {
      tool: 'SQLite',
      steps: ['No export needed.', 'Upload the .db file directly.'],
    },
  ],
} as const;

/* -------------------------------------------------------------------------- */
/* Samples and controls                                                       */
/* -------------------------------------------------------------------------- */

export const SAMPLE_FILES = {
  clean: { path: '/samples/sales_clean.csv', label: 'sales_clean.csv' },
  messy: { path: '/samples/sales_messy.csv', label: 'sales_messy.csv' },
} as const;

export const TOP_N_OPTIONS = [5, 10, 20, 50] as const;
export const PAGE_SIZES = [10, 25, 50] as const;

export const QUALITY_LEVELS = [
  { min: 90, label: 'Excellent' },
  { min: 75, label: 'Good' },
  { min: 50, label: 'Fair' },
  { min: 0, label: 'Poor' },
] as const;

/**
 * Bounds on the KPI row.
 *
 * Fewer than three stops being scannable; more than six stops fitting on one
 * row without wrapping to a ragged second line.
 */
export const MIN_METRICS = 3;
export const MAX_METRICS = 6;

/* -------------------------------------------------------------------------- */
/* Downloads                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every downloadable item in the story, keyed by a stable slug. The slug is what
 * lands in the filename, so renaming a label here never breaks a user's saved
 * files, and adding a chart to the download menu means adding one entry here.
 */
export const DOWNLOAD_ITEMS = {
  paretoCurve: { slug: 'pareto-curve', label: 'Pareto curve' },
  topProducts: { slug: 'top-products', label: 'Top products' },
  abcPie: { slug: 'abc-pie', label: 'ABC share pie' },
  abcBar: { slug: 'abc-bar', label: 'ABC value vs count' },
  histogram: { slug: 'value-histogram', label: 'Value distribution' },
  trend: { slug: 'monthly-trend', label: 'Monthly trend' },
  mostImportant: { slug: 'most-important', label: 'Most important' },
  leastImportant: { slug: 'least-important', label: 'Least important' },
  rankingTable: { slug: 'ranking-table', label: 'Ranking table' },
} as const;

export type DownloadItemSlug = (typeof DOWNLOAD_ITEMS)[keyof typeof DOWNLOAD_ITEMS]['slug'];

/** MIME type per export extension, so browsers pick a sensible handler. */
export const DOWNLOAD_MIME_TYPES: Record<string, string> = {
  csv: 'text/csv;charset=utf-8',
  svg: 'image/svg+xml;charset=utf-8',
  png: 'image/png',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

export const DOWNLOAD_COPY = {
  triggerLabel: 'Download',
  /** aria-label template; `{item}` is replaced with the item's label. */
  triggerAriaLabel: 'Download {item}',
  menuLabel: 'Download options',
  preparing: 'Preparing your download...',
  ready: 'Download ready',
  csvOption: 'CSV (data)',
  pngOption: 'PNG image',
  svgOption: 'SVG vector',
  pdfOption: 'PDF (chart)',
  lightBackground: 'Use light background',
  lightBackgroundHint: 'Print-friendly, for pasting into documents.',
  /** Also offered as a plain button, not a menu item. */
  downloadCsv: 'Download CSV',
  downloadPdf: 'Download PDF',
  errorTitle: "We couldn't create that file.",
  errorHint: 'Try again, or download the CSV instead.',
  /** Rendered on the button while busy so the label does not reflow. */
  busyLabel: 'Preparing...',
  /** Shared by every CSV/PDF the user can ask for. */
  rowCapNote: (shown: number, total: number) =>
    `Showing the first ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rows. Download the CSV for all rows.`,
  /* PDF furniture. The brand is the only place the product name is printed, and
     it is printed on every page, so the footer always identifies the file. */
  pdfDocumentTitle: 'Datalens report',
  pdfCreator: 'Datalens',
  pdfFooterBrand: 'Datalens',
  pdfPageOf: (page: number, total: number) => `Page ${page} of ${total}`,
  /** Item labels reused as chart titles and table headings in PDFs. */
  downloadReport: 'Download full report (PDF)',
  /**
   * Shown in the report options when the Unicode font cannot be loaded. Not an
   * error, but the reader should know why some product names may look wrong.
   */
  fontFallbackWarning:
    'The Unicode font could not be loaded, so the report will use a standard font. Product names outside Latin characters may not display correctly.',
  mostImportantLabel: 'Most important products',
  leastImportantLabel: 'Least important products',
  rankingTableLabel: 'Product ranking',
  rankingTableCaption: 'Products in descending order of value, with share and class.',
} as const;

/* -------------------------------------------------------------------------- */
/* Dashboard summary, KPIs, and filters                                        */
/* -------------------------------------------------------------------------- */

export const DASHBOARD_COPY = {
  /* Executive summary: the ruled block directly under the Pareto headline. */
  summaryEyebrow: 'At a glance',
  summaryTotalValue: 'Total value',
  summaryTopProduct: 'Top product',
  summaryTopProductShare: (share: string) => `${share} of total value`,
  summaryQuality: 'Quality score',
  summaryRowsProcessed: 'Rows processed',
  /**
   * Month granularity only. The response has no min/max date, so the label says
   * "months" and never implies a specific day.
   */
  summaryMonthsCovered: 'Months covered',

  /* KPI row. */
  kpiAriaLabel: 'Key figures',
  kpiFullValuePrefix: 'Exact value:',
  kpiStatusPrefix: 'Rating:',
  customizeTrigger: 'Customize',
  customizeTitle: 'Choose key figures',
  customizeHint: (min: number, max: number) =>
    `Choose between ${min} and ${max} figures. The row is easier to scan with fewer.`,
  customizeMinReached: (min: number) => `At least ${min} figures are needed.`,
  customizeMaxReached: (max: number) => `At most ${max} figures fit on one row.`,
  customizeReset: 'Reset to default',
  /** Shown in place of a hint when this file cannot produce the figure. */
  customizeUnavailable: 'Not available for this file',
  customizeSelectionCount: (count: number, min: number, max: number) =>
    `${count} of ${min} to ${max} selected`,

  /* Quality wording, shared with the quality badge. */
  qualityExcellent: 'Excellent',
  qualityGood: 'Good',
  qualityFair: 'Fair',
  qualityPoor: 'Poor',
} as const;
