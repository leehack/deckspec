export type ThemeName = 'dark' | 'light';
export type Severity = 'error' | 'warn';
export type ElementType =
  'text' | 'shape' | 'line' | 'image' | 'imageShape' | 'table' | 'chart' | 'media';
export type NativeOptions = Record<string, unknown>;

export interface DeckSize {
  w: number;
  h: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LineBox {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

export interface DeckMeta {
  author?: string;
  company?: string;
  subject?: string;
  lang?: string;
  revision?: string;
}

export interface DeckSection {
  title: string;
  order?: number;
}

export interface DeckSlideMaster {
  title: string;
  background?: NativeOptions;
  margin?: number | number[];
  slideNumber?: NativeOptions;
  objects?: NativeOptions[];
  nativeOptions?: NativeOptions;
}

export interface DeckSpec {
  schemaVersion?: '0.2.0';
  deckId: string;
  title?: string;
  template: string;
  theme: ThemeName;
  size: DeckSize;
  meta?: DeckMeta;
  sections?: DeckSection[];
  slideMasters?: DeckSlideMaster[];
  nativeOptions?: NativeOptions;
  normalized?: boolean;
  slides: DeckSlide[];
}

export interface DeckSlide {
  id: string;
  layout: string;
  masterName?: string;
  sectionTitle?: string;
  notes?: string;
  background?: string;
  backgroundImage?: string;
  backgroundData?: string;
  backgroundTransparency?: number;
  color?: string;
  slideNumber?: NativeOptions;
  nativeOptions?: NativeOptions;
  hidden?: boolean;
  elements: DeckElement[];
}

export interface ElementSourcePointer {
  style?: string;
  slot?: string;
  jsonPointer: string;
}

export interface HyperlinkSpec {
  url?: string;
  slide?: number;
  tooltip?: string;
}

export interface ImageSizingSpec {
  type: 'contain' | 'cover' | 'crop';
  w: number;
  h: number;
  x?: number;
  y?: number;
}

export type CustomGeometryPoint = [number, number];

export type CustomGeometryCommand =
  | { type: 'moveTo' | 'lineTo'; x: number; y: number }
  | { type: 'quadBezTo'; x1: number; y1: number; x: number; y: number }
  | { type: 'cubicBezTo'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'arcTo'; wR: number; hR: number; stAng: number; swAng: number }
  | { type: 'close' };

export interface CustomGeometryPathSpec {
  w?: number;
  h?: number;
  commands: CustomGeometryCommand[];
}

export interface CustomGeometrySpec {
  points?: CustomGeometryPoint[];
  paths?: CustomGeometryPathSpec[];
  rawXml?: string;
  close?: boolean;
}

export interface TextRun {
  text: string;
  options?: Record<string, unknown>;
}

export type TableCell =
  string | number | { text?: string | TableCell[]; options?: Record<string, unknown> };
export type TableRow = TableCell[];

export interface ChartSeries {
  name: string;
  labels: string[];
  values: number[];
}

export interface DeckElement extends Partial<Box>, LineBox {
  id: string;
  type: ElementType;
  slot?: string;
  style?: string;
  text?: string;
  runs?: TextRun[];
  shape?: string;
  imagePath?: string;
  imageData?: string;
  fontFace?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  margin?: number | number[];
  breakLine?: boolean;
  charSpace?: number;
  align?: string;
  valign?: string;
  fit?: string;
  hyperlink?: HyperlinkSpec;
  fill?: Record<string, unknown>;
  line?: Record<string, unknown>;
  rectRadius?: number;
  rotate?: number;
  transparency?: number;
  shadow?: Record<string, unknown>;
  objectName?: string;
  z?: number;
  altText?: string;
  flipH?: boolean;
  flipV?: boolean;
  rounding?: boolean;
  sizing?: ImageSizingSpec;
  customGeometry?: CustomGeometrySpec;
  rows?: TableRow[];
  chartType?:
    'area' | 'bar' | 'bar3D' | 'bubble' | 'doughnut' | 'line' | 'pie' | 'radar' | 'scatter';
  data?: ChartSeries[];
  showLegend?: boolean;
  showTitle?: boolean;
  showValue?: boolean;
  chartColors?: string[];
  catAxisLabelColor?: string;
  valAxisLabelColor?: string;
  catAxisLabelFontFace?: string;
  catAxisLabelFontSize?: number;
  valAxisLabelFontFace?: string;
  valAxisLabelFontSize?: number;
  catAxisTitle?: string;
  valAxisTitle?: string;
  valAxisMinVal?: number;
  valAxisMaxVal?: number;
  valGridLine?: Record<string, unknown>;
  colW?: number[];
  rowH?: number[];
  autoPage?: boolean;
  autoPageRepeatHeader?: boolean;
  autoPageHeaderRows?: number;
  mediaType?: 'audio' | 'online' | 'video';
  link?: string;
  path?: string;
  cover?: string;
  extn?: string;
  options?: NativeOptions;
  nativeOptions?: NativeOptions;
  source?: ElementSourcePointer;
  [key: string]: unknown;
}

export interface TemplateManifest {
  templateId: string;
  description?: string;
  size: DeckSize;
  themes: Record<ThemeName, string>;
  styles: string;
  layoutsDir: string;
}

export interface ThemeSpec {
  themeId: string;
  colors: Record<string, string>;
  fonts: Record<string, string>;
}

export interface LayoutSpec {
  layoutId: string;
  description?: string;
  background?: string;
  slots: Record<string, Box>;
}

export interface TemplatePack {
  rootDir: string;
  manifest: TemplateManifest;
  theme: ThemeSpec;
  styles: Record<string, Record<string, unknown>>;
  layouts: Record<string, LayoutSpec>;
}

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  jsonPointer: string;
  slideId?: string;
  elementId?: string;
  [key: string]: unknown;
}

export type QaIssue = ValidationIssue;

export interface QaReport {
  status: 'DECKSPEC_QA_PASS' | 'DECKSPEC_QA_FAIL';
  generatedAt: string;
  deckId: string;
  slideCount: number;
  checks: string[];
  summary: Record<Severity, number>;
  issues: QaIssue[];
}

export interface PptxIntegrityReport {
  file: string;
  bytes: number;
  slideXmlCount: number;
  notesXmlCount: number;
  hasContentTypes: boolean;
}

export interface RenderReport {
  status: 'DECKSPEC_RENDER_PASS';
  pptx: string;
  pdf: string;
  pngFiles: string[];
  contactSheet: string;
}

export interface SmokeReport {
  status: 'DECKSPEC_SMOKE_PASS' | 'DECKSPEC_SMOKE_FAIL';
  input: string;
  outputs: {
    normalized: string;
    qaReport: string;
    pptx: string;
    render?: RenderReport;
  };
  slideCount: number;
  qaSummary: Record<Severity, number>;
  pptx: PptxIntegrityReport;
}
