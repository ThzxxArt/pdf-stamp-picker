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
  /** 工具栏按钮显隐配置（缺省全部显示；传 false 全部隐藏） */
  toolbar?: false | {
    modes?: boolean; open?: boolean; url?: boolean; users?: boolean; copyJson?: boolean;
    zoom?: boolean; pageNav?: boolean; grid?: boolean; undoRedo?: boolean;
    panel?: boolean; clear?: boolean; stampThumb?: boolean;
  };
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
  /** 签章距页面边界的最小间距 px（默认 12；0=紧贴边界） */
  stampMargin?: number;
  /** 签章图最小显示尺寸 px（默认 24） */
  minStampSize?: number;
  /** 签章图最大显示尺寸 px（默认 480） */
  maxStampSize?: number;
  /** pdf.js 自动加载地址（默认 null：自动探测本地 vendor/ 优先，全失败才 CDN 兜底） */
  pdfjsUrl?: string;
  /** 中文 PDF 字体映射目录（显式指定 > 自动探测本地 cMaps/ > pdf.js 默认 CDN） */
  cMapUrl?: string;
  /** 旧浏览器兼容策略。默认 false = 自动兼容（自动注入 Array.at/TypedArray.at/structuredClone/replaceAll polyfill 兜底，Edge 90 也能跑）；true = 检测到原生缺失时提示升级并拒绝加载 */
  compatCheck?: boolean;
  /**
   * 纯 URL 流式加载时是否额外取一次字节计算 document.hash（默认 false）。
   * 说明：纯静态地址（load('a.pdf') / load({url:'a.pdf'}) 不带 headers）走 pdf.js 原生流式，库拿不到字节 → 默认哈希为 null；
   * 置 true 会在 PDF 展示后后台再请求一次该地址用于算 SHA-256，完成后触发 hashready 事件。
   */
  hashUrl?: boolean;
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
  /** 章图（仅 toJSON({includeImage:true}) 时输出） */
  image?: { src: string; name: string; width: number; height: number };
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
    /** PDF 文件 SHA-256 哈希（防篡改/文件指纹，部分加载方式下为 null） */
    hash?: string;
    hashAlgorithm?: 'SHA-256';
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
  /** 已有签章 JSON（toJSON()/toFlatJSON() 输出），打开后自动回显签章点与公章图 */
  json?: PickerJSON | FlatPickerJSON;
  /** 弹窗标题 */
  title?: string;
  /** 弹窗宽度：数字=px 或 CSS 值（如 '90%'） */
  width?: number | string;
  /** 弹窗高度：数字=px 或 CSS 值（如 '70%'） */
  height?: number | string;
  /** 弹窗坐标选择模式（等价 pickerOptions.mode） */
  mode?: PickerMode;
  confirmText?: string;
  cancelText?: string;
  /** 点遮罩关闭（默认 true） */
  closeOnBackdrop?: boolean;
  /** 无签章点不允许确认 */
  requireStamp?: boolean;
  /** 每个签署方至少一个签章点才允许确认（优先于 requireStamp） */
  requireAllUsers?: boolean;
  /** 确认返回的 JSON 是否包含签章图 dataURL（数据自包含，后端直接盖章；默认不含） */
  includeImage?: boolean;
  onConfirm?: (json: PickerJSON) => void | Promise<void>;
  onCancel?: () => void;
  /** 透传给选择器的选项 */
  pickerOptions?: PdfStampPickerOptions;
}

export default class PdfStampPicker {
  constructor(container: HTMLElement | string, options?: PdfStampPickerOptions);
  static version: string;

  /** 统一加载：File / ArrayBuffer / URL / 流接口配置 / pdfjs proxy */
  load(source: PdfSource, opts?: { pageNumber?: number; mode?: PickerMode; signal?: AbortSignal }): Promise<void>;
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
  removeUser(userId: string): this;

  /** 签章点管理 */
  getStamps(): (StampJSON & { user: { id: string; name: string; color: string } | null })[];
  getStampsByUser(userId: string): (StampJSON & { user: { id: string; name: string; color: string } | null })[];
  getActiveStamp(): (StampJSON & { user: { id: string; name: string; color: string } | null }) | null;
  /** 撤销/重做 */
  undo(): this;
  redo(): this;
  /** 折叠/展开签章列表面板 */
  toggleList(): this;
  /** 导出当前页+签章点布局图为 PNG（dataURL） */
  exportImage(opts?: { scale?: number; includePdf?: boolean; includeUi?: boolean }): Promise<string>;
  addStamp(sel: { x: number; y: number; width?: number; height?: number; page?: number; userId?: string; note?: string }): StampJSON;
  removeStamp(id: string): StampJSON | null;
  selectStamp(id: string): this;
  getSelection(): { page: number; x: number; y: number; width?: number; height?: number; unit: 'pt'; rotation: number } | null;
  clear(): this;
  clearAll(): this;
  removeSelection(): this;

  /** JSON 导出：toJSON() 按用户分组 / toFlatJSON() 扁平；opts.includeImage=true 含章图 dataURL（自包含） */
  toJSON(opts?: { includeImage?: boolean }): PickerJSON;
  toFlatJSON(opts?: { includeImage?: boolean }): FlatPickerJSON;
  /** 从 JSON 反显签章点与公章图（users[] 或 stamps[] 结构均可） */
  importJSON(json: PickerJSON | FlatPickerJSON, opts?: { replace?: boolean }): Promise<void>;
  copyJSON(): Promise<PickerJSON>;

  screenToPdf(x: number, y: number): { x: number; y: number };
  pdfToScreen(x: number, y: number): { x: number; y: number };

  /**
   * 获取当前 PDF 的 SHA-256（小写 hex），不可用时为 null。
   * 与 toJSON() 的同步读取不同：当以纯 URL + hashUrl:true 加载时哈希是加载后异步补算的，
   * 用此方法（或监听 hashready 事件）等待就绪；内网 HTTP 等非安全上下文也有值（库内纯 JS 兜底）。
   */
  getHash(): Promise<string | null>;

  /** 事件：loadprogress / loaddone / stampadd / stampremove / select / pagechange / zoomchange / hashready … */
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
