import { useRef, useState } from 'react';
import type { PhysisKind, PhysisRecord, PhysisStore } from './types';
import { DRUG_COLUMNS, checkPhysisImportBytes, parsePhysisBackup, type PhysisBackup, drugsFromCsv, exportPhysisCsv, parsePhysisCsv, parsePhysisRecords, previewPhysisImport, preparePhysisImport, resumePhysisImport, type ImportPreview, type PreparedPhysisImport } from './exchange-domain';
import { openBackup } from '../backup-format';
import { authorizeBackup } from '../backup-device';
import { personalDocumentAccess, allowCurrentDataTransfer } from '../cloud-sync';
import {useDataTransferGuard} from '../FeatureAccessContext';
import { openAccountPhysisVault, openPhysis, unlockPhysisVault } from './crypto';
import { Field, usePhysisAction } from './fields';

export function downloadPhysis(name: string, content: string, type = 'application/json') {
  if (!allowCurrentDataTransfer()) return;
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PhysisExchange({ store, kind, exportEncrypted }: { store: PhysisStore; kind?: PhysisKind; exportEncrypted?: () => Promise<void> }) {
  const transfer=useDataTransferGuard();
  const action = usePhysisAction(); const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<string[][] | null>(null); const [mapping, setMapping] = useState<Record<string, string>>({});
  const [backup, setBackup] = useState<PhysisBackup | null>(null); const [recovery, setRecovery] = useState('');
  const [report, setReport] = useState(''); const [accepted, setAccepted] = useState(false);
  const [genesisFile, setGenesisFile] = useState<string | null>(null);
  const prepared = useRef<PreparedPhysisImport | null>(null);
  const records = store.records.filter(r => !kind || r.kind === kind);
  const openFile = async (file: File) => {
    if (!transfer.check()) return;
    checkPhysisImportBytes(file.size);
    const text = await file.text(); if (!transfer.check()) return;
    setPreview(null); setRows(null); setBackup(null); setGenesisFile(null); setAccepted(false); setReport(''); prepared.current = null;
    if (file.name.toLowerCase().endsWith('.csv')) {
      const parsed = parsePhysisCsv(text);
      if (kind === 'drug' && !parsed[0]?.includes('recordJSON')) {
        setRows(parsed); setMapping(Object.fromEntries(DRUG_COLUMNS.map(key => [key, parsed[0]?.includes(key) ? key : '']))); return;
      }
      setPreview(previewPhysisImport(parsePhysisRecords(text, 'csv'), store.records, kind)); return;
    }
    const json = JSON.parse(text);
    if (json?.format === 'genesisbackup') { setGenesisFile(text); return; }
    if (json?.format === 'physis-encrypted') { setBackup(parsePhysisBackup(json)); return; }
    setPreview(previewPhysisImport(parsePhysisRecords(text, 'json'), store.records, kind));
  };
  const plainExport = (format: 'json' | 'csv') => {
    if (!transfer.check()) return;
    if (!confirm('Открытый экспорт содержит личные данные без шифрования. Сохранить файл на устройство?')) return;
    downloadPhysis(`physis-${kind ?? 'all'}.${format}`, format === 'json' ? JSON.stringify({ format: 'physis-plain', version: 1, records }) : exportPhysisCsv(records), format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
  };
  return <details className="physis-exchange"><summary>Импорт и экспорт {kind === 'drug' ? 'справочника' : 'данных'}</summary>
    <p className="physis-muted">JSON сохраняет полную структуру. CSV содержит читаемые поля и recordJSON для точного восстановления. Файл обрабатывается в этой вкладке; сторонним сервисам не отправляется.</p>
    <div className="physis-actions"><button onClick={() => plainExport('json')}>Открытый JSON</button><button onClick={() => plainExport('csv')}>Открытый CSV</button>{exportEncrypted ? <button onClick={() => void action.run(async()=>{if(transfer.check())await exportEncrypted();})}>Зашифрованная резервная копия</button> : null}
      {kind === 'drug' ? <button onClick={() => downloadPhysis('physis-drugs-template.csv', '\uFEFF' + DRUG_COLUMNS.join(',') + '\r\n', 'text/csv;charset=utf-8')}>Шаблон CSV препаратов</button> : null}</div>
    <Field label="Выбрать CSV / JSON для предварительного просмотра"><input type="file" accept=".csv,.json,.genesisbackup,text/csv,application/json" onChange={e => { const file = e.target.files?.[0]; if (file) void action.run(() => openFile(file)); e.target.value = ''; }} /></Field>
    {genesisFile ? <form className="physis-form" onSubmit={event=>{event.preventDefault();void action.run(async()=>{
      await authorizeBackup();const payload=await openBackup(genesisFile,recovery);personalDocumentAccess(payload.ownerId).check();
      const section=payload.sections.find(row=>row.id==='physis');const values=(section?.data as {records?:PhysisRecord[]}|null)?.records;
      if(!Array.isArray(values))throw new Error('В этой копии нет разблокированных записей Фюзиса. Сохранённые зашифрованные записи требуют отдельного исходного ключа.');
      await authorizeBackup();if(!transfer.check())return;setPreview(previewPhysisImport(values,store.records,kind));setGenesisFile(null);setRecovery('');
    });}}><Field label="Ключ копии .genesisbackup"><input type="password" autoComplete="off" value={recovery} onChange={event=>setRecovery(event.target.value)}/></Field><button disabled={action.busy}>Расшифровать для предпросмотра</button></form> : null}
    {rows ? <><h3>Сопоставление колонок</h3><p className="physis-muted">Категория: supplement / medicine. Путь: oral / intramuscular / subcutaneous / intravenous / topical / inhalation / other. Единицы активного вещества обязательны при указанном количестве: mg / mcg / g / IU; концентрация — эти единицы на ml.</p><div className="physis-form">{DRUG_COLUMNS.map(key => <Field label={key} key={key}><select value={mapping[key] ?? ''} onChange={e => { setMapping({ ...mapping, [key]: e.target.value }); setPreview(null); setAccepted(false); prepared.current = null; }}><option value="">Не сопоставлено</option>{rows[0].map((h, i) => <option key={i}>{h}</option>)}</select></Field>)}</div><button onClick={() => setPreview(previewPhysisImport(drugsFromCsv(rows, mapping), store.records, 'drug'))}>Проверить импорт</button></> : null}
    {backup ? <form className="physis-form" onSubmit={e => { e.preventDefault(); void action.run(async () => {
      if (!transfer.check()) return;
      const key = backup.vault.version === 2 ? await openAccountPhysisVault(personalDocumentAccess(backup.owner), backup.vault) : await unlockPhysisVault(backup.owner, backup.vault, recovery, 'recovery'); setRecovery('');
      const values: PhysisRecord[] = [];
      for (const record of backup.records) if (!record.deletedAt && record.envelope) values.push(await openPhysis(key, backup.owner, record.id, backup.vault.keyVersion, record.envelope) as PhysisRecord);
      if (!transfer.check()) return;
      setPreview(previewPhysisImport(values, store.records, kind)); setBackup(null);
    }); }}><p className="physis-wide">{backup.vault.version === 2 ? 'Копия откроется через тот аккаунт GENESIS, в котором была создана.' : 'Введите код восстановления именно этой резервной копии.'} После проверки записи будут заново зашифрованы ключом текущего аккаунта.</p>{backup.vault.version === 1 ? <Field label="Код восстановления резервной копии"><input type="password" autoComplete="off" value={recovery} onChange={e => setRecovery(e.target.value)} /></Field> : null}<button disabled={action.busy}>Расшифровать для предпросмотра</button></form> : null}
    {preview ? <><p>Готово к импорту: {preview.records.length}. Дубли пропущены: {preview.duplicates}. Ошибки: {preview.errors.length}.</p>{preview.errors.length ? <ul>{preview.errors.slice(0, 30).map((error, i) => <li key={i}>{error}</li>)}</ul> : null}<div className="physis-table-wrap"><table><caption>Предварительный результат — данные ещё не записаны</caption><thead><tr><th>Тип</th><th>Название / показатель</th><th>Версия</th></tr></thead><tbody>{preview.records.slice(0, 30).map(record => <tr key={record.id}><td>{record.kind}</td><td>{String((record.data as { name?: string; label?: string }).name ?? (record.data as { label?: string }).label ?? record.id)}</td><td>{record.schemaVersion}</td></tr>)}</tbody></table></div>
      <label className="physis-check"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />Создать новые записи из предпросмотра. Существующие записи не перезаписываются.</label><button className="physis-primary" disabled={!accepted || !preview.records.length || action.busy} onClick={() => void action.run(async () => {
        if (!transfer.check()) return;
        if (!prepared.current) prepared.current = preparePhysisImport(preview.records);
        await resumePhysisImport(prepared.current, store, (confirmed, total) => setReport(`Подтверждено сервером: ${confirmed} из ${total}.`));
        setPreview(null); setAccepted(false); prepared.current = null;
      })}>Импортировать {preview.records.length} записей</button></> : null}
    {report ? <p role="status">{report}</p> : null}{action.error ? <p role="alert" className="physis-warning">{action.error}</p> : null}
  </details>;
}
