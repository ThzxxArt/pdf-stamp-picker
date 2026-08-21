// TypeScript declarations for PdfStampPicker v2.0.0

export type PickerMode = 'point' | 'rect' | 'stamp';
export type PickerZoom = number | 'fit-width' | 'fit-page';
export type PickerTheme = 'dark' | 'light';

export interface StampImage {
  src: string;
  name: string;
  width: number;
  height: number;
}

export interface PickerUser {
  id: string;
  name: string;
  color?: string;
}

export interface PdfStampPickerOptions {
  /** 初始选择模式：'point' 点选 / 'rect' 框选 */
  mode?: PickerMode;
  /** 初始缩放：数字(1pt→N px) | 'fit-width' | 'fit-page' */
  zoom?: PickerZoom;
  /** 选区固定宽高比 (w/h) */
  aspectRatio?: number | null;
  /** 选区最小尺寸（屏幕 px） */
  minSize?: number;
  /** 显示网格辅助线 */
  showGrid?: boolean;
  /** 内置工具栏 + 列表（默认开启，宿主无需写任何 HTML/CSS） */
  controls?: boolean;
  /** 签章点列表面板 */
  showList?: boolean;
  /** 主题 */
  theme?: PickerTheme;
  /** px 单位换算参考 */
  dpi?: number;
  /** 用户列表（多用户签章归属） */
  users?: PickerUser[];
  /** 当前用户 id */
  currentUser?: string;
  /** 允许多签章点（默认 true） */
  allowMulti?: boolean;
  /** 初始签章图片（可选；不配则内置公章按用户名生成） */
  stampImage?: string | File | HTMLCanvasElement | null;
  /** 签章图显示基准宽度 px（默认 120） */
  stampSize?: number;
  /** 签章图最小显示尺寸 px（默认 24） */
  minStampSize?: number;
  /** 签章图最大显示尺寸 px（默认 480） */
  maxStampSize?: number;
  /** pdf.js 自动加载地址（默认 CDN，可不配） */
  pdfjsUrl?: string;
  /** 已有 pdfjsLib 实例（可选，避免重复加载） */
  pdfjs?: unknown;
}

export interface SetPageMeta {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  rotation?: number;
  pageNumber?: number;
  totalPages?: number;
  offsetX?: number;
  offsetY?: number;
  name?: string;
}

/** PDF 来源：本地上传 File / ArrayBuffer / URL / 文件流接口 / pdfjs proxy */
export type PdfSource =
  | File
  | ArrayBuffer
  | Uint8Array
  | string
  | { url: string; method?: string; headers?: Record<string, string>; body?: BodyInit }
  | { getPage: Function; numPages: number };

export interface StampJSON {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  unit: 'pt';
  rotation: number;
  note: string;
  createdAt: string;
}

/** 按用户分组：每个签署方（user）下挂自己的签章点坐标 */
export interface SignerGroup {
  user: { id: string; name: string; color: string };
  stamps: StampJSON[];
}

export interface PickerJSON {
  document: {
    name: string;
    pages: number;
    currentPage: number;
    pageSize: { width: number; height: number; unit: 'pt' };
    rotation: number;
    generatedAt: string;
  };
  /** 签署方数组（含无签章点的签署方，stamps 为空数组） */
  users: SignerGroup[];
}

/** 扁平版 JSON（每项内嵌 user） */
export interface FlatPickerJSON {
  document: PickerJSON['document'];
  stamps: (StampJSON & { user: { id: string; name: string; color: string } | null })[];
}

export interface OpenModalConfig extends Partial<PdfStampPickerOptions> {
  /** PDF 来源（统一入口） */
  source?: PdfSource;
  /** 弹窗标题 */
  title?: string;
  confirmText?: string;
  cancelText?: string;
  /** 点遮罩关闭（默认 true） */
  closeOnBackdrop?: boolean;
  /** 无签章点不允许确认 */
  requireStamp?: boolean;
  onConfirm?: (json: PickerJSON) => void | Promise<void>;
  onCancel?: () => void;
  /** 透传给选择器的选项 */
  pickerOptions?: PdfStampPickerOptions;
}

export default class PdfStampPicker {
  constructor(container: HTMLElement | string, options?: PdfStampPickerOptions);
  static version: string;

  /** 统一加载：File / ArrayBuffer / URL / 流接口配置 / pdfjs proxy */
  load(source: PdfSource, opts?: { pageNumber?: number }): Promise<void>;
  /** 兼容 v1 的 PDF.js 集成模式 */
  loadPDF(source: PdfSource, opts?: { pageNumber?: number }): Promise<void>;
  /** 纯画布模式 */
  setPage(meta: SetPageMeta): this;
  /** 翻页 */
  gotoPage(n: number): Promise<void>;

  setZoom(z: PickerZoom): this;
  getZoom(): number;
  fitWidth(): this;
  fitPage(): this;

  setMode(mode: PickerMode): this;
  setAspectRatio(ratio: number | null): this;
  setShowGrid(show: boolean): this;

  /** 签章图 */
  setStampImage(src: string | File | HTMLCanvasElement): Promise<StampImage>;
  getStampImage(): StampImage | null;

  /** 用户 */
  setCurrentUser(userId: string): this;
  getCurrentUser(): PickerUser | null;
  addUser(user: PickerUser): this;

  /** 签章点管理 */
  getStamps(): (StampJSON & { user: { id: string; name: string; color: string } | null })[];
  getStampsByUser(userId: string): (StampJSON & { user: { id: string; name: string; color: string } | null })[];
  getActiveStamp(): (StampJSON & { user: { id: string; name: string; color: string } | null }) | null;
  addStamp(sel: { x: number; y: number; width?: number; height?: number; page?: number; userId?: string; note?: string }): StampJSON;
  removeStamp(id: string): StampJSON | null;
  selectStamp(id: string): this;
  getSelection(): { page: number; x: number; y: number; width?: number; height?: number; unit: 'pt'; rotation: number } | null;
  clear(): this;
  clearAll(): this;
  removeSelection(): this;

  /** JSON 导出：toJSON() 按用户分组 / toFlatJSON() 扁平 / copyJSON() 复制 */
  toJSON(): PickerJSON;
  toFlatJSON(): FlatPickerJSON;
  copyJSON(): Promise<PickerJSON>;

  screenToPdf(x: number, y: number): { x: number; y: number };
  pdfToScreen(x: number, y: number): { x: number; y: number };

  on(type: string, fn: (payload: any) => void): this;
  off(type: string, fn: (payload: any) => void): this;

  destroy(): void;

  /** 一键弹窗，确认返回 toJSON()，取消返回 null */
  static openModal(config: OpenModalConfig): Promise<PickerJSON | null>;
  /** 预加载 pdf.js（指定地址） */
  static loadPdfJs(url?: string): Promise<unknown>;
  /** 自动探测加载 pdf.js（本地 vendor/libs → CDN 兜底） */
  static loadPdfJsAuto(): Promise<unknown>;
}
