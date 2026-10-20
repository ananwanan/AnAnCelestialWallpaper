import type { Language } from '../i18n';

const en = {
  title: 'AnAn Celestial Wallpaper', scene: '3D Solar System', view: 'View', solar: 'Solar System', earth: 'Earth', settings: 'Display & Time', close: 'Close settings',
  camera: 'Camera', overview: 'Overview', inner: 'Inner planets', outer: 'Outer planets', earthMoon: 'Earth & Moon', resetCamera: 'Reset camera',
  display: 'Display', orbits: 'Orbit paths', labels: 'Body names', statusBar: 'Show time and data status', mouse: 'Mouse drag and zoom', quality: 'Quality',
  low: 'Low · Power saving', medium: 'Medium · Balanced', high: 'High · Detailed',
  language: 'Language', autoLanguage: 'System default', simulationTime: 'Simulation time · UTC', timeScale: 'Time scale', paused: 'Paused', realTime: '1× Real time',
  jumpUtc: 'Jump to UTC date', applyDate: 'Apply date', now: 'Return to now', invalidUtc: 'Enter a valid UTC date (1962–2100).',
  data: 'Data', syncInterval: 'Remote comparison interval', oneHour: '1 hour', sixHours: '6 hours', day: '24 hours',
  localNote: 'The animation uses local ephemerides. Horizons only compares data at the same UTC time; the scene keeps running offline.',
  satellites: 'Artificial satellites · Off by default', showSatellites: 'Show predicted satellites', satelliteGroup: 'Dataset', stations: 'ISS / Tiangong', selectSatellite: 'Select satellite',
  noData: 'No data available', disabledSatellites: 'Disabled · No satellite requests',
  satelliteNote: 'Local SGP4 prediction; cyan shows recent positions and gold shows future positions. Source refreshes are at least 2 hours apart. Earth orientation uses UT1≈UTC without polar motion; satellite positions are approximate visualizations.',
  earthNote: 'Earth focus uses an independent km scale, preserving Earth–Moon distance and radius ratios. Earth orientation uses sidereal time, precession and nutation; surface maps are static references, not live remote sensing.',
  localSgp4: 'SGP4 · LOCAL PREDICTION', arcLegend: 'Cyan: recent prediction · Gold: future prediction', simulationUtc: 'SIMULATION · UTC',
  pause: 'Pause simulation time', resume: 'Resume simulation time', localPrediction: 'Local prediction', liveSync: 'Live/Sync', cached: 'Cached', disabled: 'Disabled', unavailable: 'Unavailable', localEphemeris: 'Local ephemeris',
  comparing: 'Remote comparison pending · Local rendering', comparisonPassed: 'Reference check passed · Local rendering', comparisonFailed: 'Reference difference needs review · Local rendering', offline: 'Offline · Local rendering',
  referenceEpoch: 'Reference UTC: {epoch}; retrieved: {retrievedAt}. Remote ICRF and local EQJ are approximately aligned frames.', noReference: 'No remote reference data yet.',
  solarScale: 'Orbit spacing compressed · Body sizes exaggerated', earthScale: 'Independent Earth–Moon scale · UT1≈UTC · No polar motion', earthUnit: 'EARTH / km / EQJ J2000',
  absentSatellite: 'NORAD {id} · Not in this dataset', satelliteInfo: 'NORAD {id} · Altitude {altitude} km · Element age {age} days{stale}\nOMM UTC: {elementEpoch}\nPosition UTC: {epoch}',
  stale: ' · Stale data; prediction accuracy is reduced', rejectedSatellite: 'Prediction refused for NORAD {id}: {reason}', recordInfo: 'OMM UTC: {epoch}; switch to Earth view for prediction.',
  missingSatellite: 'NORAD {id} is not in this dataset; select an ID in the dataset or enter 0 for automatic selection.', noOrbitData: 'No usable orbital data; no invented satellites are generated.', noSatellite: 'No satellite available',
  performance: '{cap} FPS cap · Actual {fps} FPS · {calls} draw calls · {quality}{paused}', hostPaused: ' · Host paused',
  fatal: 'Unable to create the 3D scene. Check that the host supports WebGL2, then reload. {error}',
} as const;

export type UiMessageKey = keyof typeof en;
type Messages = Record<UiMessageKey, string>;
const zhCN: Messages = {
  title: '安安天体壁纸', scene: '三维太阳系', view: '视角', solar: '太阳系', earth: '地球', settings: '显示与时间', close: '关闭设置',
  camera: '镜头', overview: '全景', inner: '内行星', outer: '外行星', earthMoon: '地月全景', resetCamera: '重置镜头',
  display: '画面', orbits: '轨道线', labels: '天体名称', statusBar: '显示时间与数据状态栏', mouse: '鼠标拖动与缩放', quality: '画质',
  low: '低 · 节能', medium: '中 · 均衡', high: '高 · 精细',
  language: '语言', autoLanguage: '跟随系统', simulationTime: '模拟时间 · UTC', timeScale: '时间倍率', paused: '暂停', realTime: '1× 实时',
  jumpUtc: '跳转到 UTC 日期', applyDate: '应用日期', now: '回到现在', invalidUtc: '请输入有效的 UTC 日期（1962–2100）。',
  data: '数据', syncInterval: '远程校验间隔', oneHour: '1 小时', sixHours: '6 小时', day: '24 小时',
  localNote: '动画由本地星历计算。Horizons 只校验同一 UTC 时刻的数据，断网可继续运行。',
  satellites: '人造卫星 · 默认关闭', showSatellites: '显示预测卫星', satelliteGroup: '数据组', stations: 'ISS / 天宫', selectSatellite: '选择卫星',
  noData: '暂无可用数据', disabledSatellites: '已关闭 · 无卫星请求',
  satelliteNote: 'SGP4 本地预测；青色为近期、金色为未来。源数据至少间隔 2 小时更新。地球姿态采用 UT1≈UTC，未使用极移修正；卫星位置为近似可视化。',
  earthNote: '地球特写以 km 独立计量，地月距离和半径比例保留。地球使用恒星时及岁差章动模型校准；地表贴图为静态参考，非实时遥感。',
  localSgp4: 'SGP4 · 本地预测', arcLegend: '青色：近期预测 · 金色：未来预测', simulationUtc: '模拟时间 · UTC',
  pause: '暂停模拟时间', resume: '继续模拟时间', localPrediction: '本地预测', liveSync: '同步参考', cached: '已缓存', disabled: '已关闭', unavailable: '不可用', localEphemeris: '本地星历',
  comparing: '远程校验中 · 本地运行', comparisonPassed: '参考校验通过 · 本地运行', comparisonFailed: '参考差异待核查 · 本地运行', offline: '离线 · 本地运行',
  referenceEpoch: '参考 UTC：{epoch}；源数据获取：{retrievedAt}。远程 ICRF 与本地 EQJ 为近似对齐坐标系。', noReference: '尚无远程参考数据。',
  solarScale: '轨道间距压缩 · 天体尺寸放大', earthScale: '地月独立尺度 · UT1≈UTC · 未修正极移', earthUnit: '地球 / km / EQJ J2000',
  absentSatellite: 'NORAD {id} · 当前组无此卫星', satelliteInfo: 'NORAD {id} · 高度 {altitude} km · 源历元年龄 {age} 天{stale}\nOMM UTC：{elementEpoch}\n位置 UTC：{epoch}',
  stale: ' · 数据已陈旧，预测精度下降', rejectedSatellite: '拒绝推算 NORAD {id}：{reason}', recordInfo: 'OMM UTC：{epoch}；切换地球视角后推算。',
  missingSatellite: '当前数据组没有 NORAD {id}；请选择同组编号或填 0 自动选择。', noOrbitData: '无可用轨道数据；不会生成虚构卫星。', noSatellite: '暂无可用卫星',
  performance: '{cap} FPS 上限 · 实际 {fps} FPS · {calls} 次绘制 · {quality}{paused}', hostPaused: ' · 宿主已暂停',
  fatal: '无法创建三维画面。请确认宿主支持 WebGL2 后重新载入。{error}',
};
const zhTW: Messages = {
  title: '安安天體桌布', scene: '三維太陽系', view: '視角', solar: '太陽系', earth: '地球', settings: '顯示與時間', close: '關閉設定',
  camera: '鏡頭', overview: '全景', inner: '內行星', outer: '外行星', earthMoon: '地月全景', resetCamera: '重設鏡頭',
  display: '畫面', orbits: '軌道線', labels: '天體名稱', statusBar: '顯示時間與資料狀態列', mouse: '滑鼠拖曳與縮放', quality: '畫質',
  low: '低 · 節能', medium: '中 · 均衡', high: '高 · 精細',
  language: '語言', autoLanguage: '跟隨系統', simulationTime: '模擬時間 · UTC', timeScale: '時間倍率', paused: '暫停', realTime: '1× 即時',
  jumpUtc: '跳轉到 UTC 日期', applyDate: '套用日期', now: '回到現在', invalidUtc: '請輸入有效的 UTC 日期（1962–2100）。',
  data: '資料', syncInterval: '遠端校驗間隔', oneHour: '1 小時', sixHours: '6 小時', day: '24 小時',
  localNote: '動畫由本機星曆計算。Horizons 只校驗同一 UTC 時刻的資料，離線可繼續執行。',
  satellites: '人造衛星 · 預設關閉', showSatellites: '顯示預測衛星', satelliteGroup: '資料組', stations: 'ISS / 天宮', selectSatellite: '選擇衛星',
  noData: '暫無可用資料', disabledSatellites: '已關閉 · 無衛星請求',
  satelliteNote: 'SGP4 本機預測；青色為近期、金色為未來。來源資料至少間隔 2 小時更新。地球姿態採用 UT1≈UTC，未使用極移修正；衛星位置為近似視覺化。',
  earthNote: '地球特寫以 km 獨立計量，保留地月距離與半徑比例。地球使用恆星時及歲差章動模型校準；地表貼圖為靜態參考，非即時遙測。',
  localSgp4: 'SGP4 · 本機預測', arcLegend: '青色：近期預測 · 金色：未來預測', simulationUtc: '模擬時間 · UTC',
  pause: '暫停模擬時間', resume: '繼續模擬時間', localPrediction: '本機預測', liveSync: '同步參考', cached: '已快取', disabled: '已關閉', unavailable: '無法使用', localEphemeris: '本機星曆',
  comparing: '遠端校驗中 · 本機執行', comparisonPassed: '參考校驗通過 · 本機執行', comparisonFailed: '參考差異待核查 · 本機執行', offline: '離線 · 本機執行',
  referenceEpoch: '參考 UTC：{epoch}；來源資料取得：{retrievedAt}。遠端 ICRF 與本機 EQJ 為近似對齊座標系。', noReference: '尚無遠端參考資料。',
  solarScale: '軌道間距壓縮 · 天體尺寸放大', earthScale: '地月獨立尺度 · UT1≈UTC · 未修正極移', earthUnit: '地球 / km / EQJ J2000',
  absentSatellite: 'NORAD {id} · 目前資料組無此衛星', satelliteInfo: 'NORAD {id} · 高度 {altitude} km · 來源曆元年齡 {age} 天{stale}\nOMM UTC：{elementEpoch}\n位置 UTC：{epoch}',
  stale: ' · 資料已陳舊，預測精度下降', rejectedSatellite: '拒絕推算 NORAD {id}：{reason}', recordInfo: 'OMM UTC：{epoch}；切換地球視角後推算。',
  missingSatellite: '目前資料組沒有 NORAD {id}；請選擇同組編號或填 0 自動選擇。', noOrbitData: '無可用軌道資料；不會產生虛構衛星。', noSatellite: '暫無可用衛星',
  performance: '{cap} FPS 上限 · 實際 {fps} FPS · {calls} 次繪製 · {quality}{paused}', hostPaused: ' · 主程式已暫停',
  fatal: '無法建立三維畫面。請確認主程式支援 WebGL2 後重新載入。{error}',
};

export const UI_MESSAGES: Readonly<Record<Language, Readonly<Messages>>> = { en, 'zh-CN': zhCN, 'zh-TW': zhTW };
export function uiMessage(language: Language, key: UiMessageKey, values: Readonly<Record<string, string | number>> = {}): string {
  return UI_MESSAGES[language][key].replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values[name] ?? placeholder));
}

const provenanceKeys = { 'Local prediction': 'localPrediction', 'Live/Sync': 'liveSync', Cached: 'cached', Disabled: 'disabled', Unavailable: 'unavailable' } as const;
export function provenanceLabel(language: Language, label: keyof typeof provenanceKeys): string { return uiMessage(language, provenanceKeys[label]); }

/** Provider exceptions retain their original diagnostics; routine status text is translated here. */
const providerDetails: Readonly<Record<string, readonly [string, string]>> = {
  'Local ephemeris; remote provider is not configured.': ['本地星历；未配置远程数据服务。', '本機星曆；未設定遠端資料服務。'],
  'Local ephemeris; waiting for the configured remote comparison.': ['本地星历；等待已配置的远程校验。', '本機星曆；等待已設定的遠端校驗。'],
  'Invalid ephemeris service URL; local ephemeris continues.': ['星历服务地址无效；本地星历继续运行。', '星曆服務網址無效；本機星曆繼續執行。'],
  'Offline; the last valid Horizons comparison is cached. Local ephemeris continues.': ['离线；保留上次有效的 Horizons 校验缓存，本地星历继续运行。', '離線；保留上次有效的 Horizons 校驗快取，本機星曆繼續執行。'],
  'Offline; local ephemeris continues without a remote comparison.': ['离线；无远程校验，本地星历继续运行。', '離線；無遠端校驗，本機星曆繼續執行。'],
  'Offline; using local ephemeris and the last valid comparison.': ['离线；使用本地星历与上次有效的校验数据。', '離線；使用本機星曆與上次有效的校驗資料。'],
  'Requesting one shared Horizons comparison; local ephemeris continues.': ['正在请求共享 Horizons 校验；本地星历继续运行。', '正在請求共用 Horizons 校驗；本機星曆繼續執行。'],
  'Stale cached Horizons comparison; source refresh is deferred until the retry cooldown. Local ephemeris continues.': ['Horizons 校验缓存已陈旧；将在重试冷却结束后刷新来源，本地星历继续运行。', 'Horizons 校驗快取已陳舊；將在重試冷卻結束後更新來源，本機星曆繼續執行。'],
  'Cached Horizons comparison at the stated UTC epoch; local ephemeris drives the scene.': ['使用所示 UTC 历元的 Horizons 校验缓存；画面由本地星历驱动。', '使用所示 UTC 曆元的 Horizons 校驗快取；畫面由本機星曆驅動。'],
  'Live/Sync: Horizons comparison only; local ephemeris drives the scene.': ['实时同步：仅用于 Horizons 校验；画面由本地星历驱动。', '即時同步：僅用於 Horizons 校驗；畫面由本機星曆驅動。'],
  'Cached comparison expired after 24 hours; local ephemeris continues.': ['校验缓存已超过 24 小时并过期；本地星历继续运行。', '校驗快取已超過 24 小時並到期；本機星曆繼續執行。'],
  'Cached comparison; source retrieval is older than 6 hours. Local ephemeris continues.': ['使用校验缓存；来源获取已超过 6 小时，本地星历继续运行。', '使用校驗快取；來源取得已超過 6 小時，本機星曆繼續執行。'],
  'Cached Horizons comparison; startup will still request current UTC once.': ['使用 Horizons 校验缓存；启动时仍会请求一次当前 UTC 数据。', '使用 Horizons 校驗快取；啟動時仍會請求一次目前 UTC 資料。'],
  'Satellite tracking is disabled; no satellite requests or propagation.': ['卫星追踪已关闭；不会请求或推算卫星。', '衛星追蹤已關閉；不會請求或推算衛星。'],
  'Starlink remains planned for the performance-gated M5 milestone.': ['Starlink 仍为 M5 性能验收后的计划功能。', 'Starlink 仍為 M5 效能驗收後的計畫功能。'],
  'No satellite GP service is configured; no invented satellite positions are shown.': ['未配置卫星 GP 服务；不会显示虚构的卫星位置。', '未設定衛星 GP 服務；不會顯示虛構的衛星位置。'],
  'CelesTrak returned a policy error. Source requests stopped; repository owner must investigate before resetting the server gate.': ['CelesTrak 返回了策略错误，已停止来源请求；仓库所有者须调查后再重置服务端门控。', 'CelesTrak 傳回政策錯誤，已停止來源請求；儲存庫擁有者須調查後再重設伺服器閘控。'],
  'Offline; cached orbital elements support local SGP4 predictions within their epoch window.': ['离线；在有效历元窗口内使用轨道根数缓存进行本地 SGP4 预测。', '離線；在有效曆元視窗內使用軌道根數快取進行本機 SGP4 預測。'],
  'Offline and no usable orbital elements are cached.': ['离线，且没有可用的轨道根数缓存。', '離線，且沒有可用的軌道根數快取。'],
  'Using cached CelesTrak orbital elements for local SGP4 predictions; the persisted source refresh cooldown is retained.': ['使用 CelesTrak 轨道根数缓存进行本地 SGP4 预测；保留已记录的来源刷新冷却时间。', '使用 CelesTrak 軌道根數快取進行本機 SGP4 預測；保留已記錄的來源更新冷卻時間。'],
  'Satellite tracking enabled; waiting for scoped orbital elements or the persisted source refresh cooldown.': ['卫星追踪已启用；等待指定数据组的轨道根数或已记录的刷新冷却时间结束。', '衛星追蹤已啟用；等待指定資料組的軌道根數或已記錄的更新冷卻時間結束。'],
  'Selected dataset changed; cached elements and the independent source refresh cooldown are retained.': ['已切换数据组；保留轨道根数缓存与独立的来源刷新冷却时间。', '已切換資料組；保留軌道根數快取與獨立的來源更新冷卻時間。'],
  'Offline; cached elements remain usable within the prediction window.': ['离线；预测窗口内仍可使用轨道根数缓存。', '離線；預測視窗內仍可使用軌道根數快取。'],
};
export function providerDetail(language: Language, detail: string): string {
  if (language === 'en') return detail;
  const known = providerDetails[detail];
  if (known) return known[language === 'zh-CN' ? 0 : 1];
  const request = /^Requesting scoped (stations|gps) orbital elements; positions will be predicted locally\.$/.exec(detail);
  if (request) return language === 'zh-CN' ? `正在请求 ${request[1] === 'stations' ? '空间站' : 'GPS'} 轨道根数；位置将在本地预测。` : `正在請求 ${request[1] === 'stations' ? '太空站' : 'GPS'} 軌道根數；位置將在本機預測。`;
  const synced = /^(Cached|Live\/Sync) CelesTrak orbital elements; all displayed positions and trajectory arcs are local SGP4 predictions\. TEME conversion approximates UT1=UTC and omits polar motion\.$/.exec(detail);
  if (synced) {
    const label = provenanceLabel(language, synced[1] as 'Cached' | 'Live/Sync');
    return language === 'zh-CN' ? `${label}的 CelesTrak 轨道根数；所有显示位置和轨迹弧均为本地 SGP4 预测。TEME 转换近似采用 UT1=UTC，并忽略极移。` : `${label}的 CelesTrak 軌道根數；所有顯示位置和軌跡弧均為本機 SGP4 預測。TEME 轉換近似採用 UT1=UTC，並忽略極移。`;
  }
  return detail;
}
