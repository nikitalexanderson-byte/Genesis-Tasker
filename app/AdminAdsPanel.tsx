"use client";
/* eslint-disable @next/next/no-img-element -- Admin-supplied previews can be data URLs or external images. */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { deleteAdminAd, loadAdminAds, saveAdminAd, type AdminAd, type AdminAdInput } from "./cloud-sync";
import { runtimeLocale } from "./i18n";

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toUtc(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function codes(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/u).map((part) => part.trim()).filter(Boolean))];
}

const emptyForm = {
  title: "", description: "", imageUrl: "", imageData: "", linkUrl: "",
  languages: "", countries: "", platforms: ["web", "android"],
  startsAt: "", endsAt: "", repeatHours: 24, priority: 0, enabled: false,
};

export function AdminAdsPanel() {
  const english = runtimeLocale().startsWith("en");
  const [ads, setAds] = useState<AdminAd[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const result = await loadAdminAds();
    setAds(result.ads);
  }, []);
  useEffect(() => {
    let active = true;
    void loadAdminAds().then((result) => { if (active) setAds(result.ads); })
      .catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);

  const edit = (ad: AdminAd) => {
    setEditingId(ad.id);
    setForm({ title: ad.title, description: ad.description,
      imageUrl: ad.imageUrl.startsWith("data:") ? "" : ad.imageUrl,
      imageData: ad.imageUrl.startsWith("data:") ? ad.imageUrl : "",
      linkUrl: ad.linkUrl, languages: ad.languages.join(", "), countries: ad.countries.join(", "),
      platforms: ad.platforms.length ? ad.platforms : ["web", "android"],
      startsAt: localDateTime(ad.startsAt), endsAt: localDateTime(ad.endsAt),
      repeatHours: ad.repeatHours, priority: ad.priority, enabled: ad.enabled });
  };
  const reset = () => { setEditingId(null); setForm({ ...emptyForm }); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const input: AdminAdInput = {
        title: form.title, description: form.description,
        imageUrl: form.imageUrl, imageData: form.imageData,
        linkUrl: form.linkUrl, languages: codes(form.languages).map((part) => part.toLowerCase()),
        countries: codes(form.countries).map((part) => part.toUpperCase()),
        platforms: form.platforms, startsAt: toUtc(form.startsAt), endsAt: toUtc(form.endsAt),
        repeatHours: Number(form.repeatHours), priority: Number(form.priority), enabled: form.enabled,
      };
      await saveAdminAd(input, editingId ?? undefined);
      await refresh(); reset();
      setMessage(english ? "Advertisement saved." : "Объявление сохранено.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const remove = async (ad: AdminAd) => {
    if (!window.confirm(english ? `Delete “${ad.title}”?` : `Удалить «${ad.title}»?`)) return;
    setBusy(true); setError("");
    try { await deleteAdminAd(ad.id); await refresh(); if (editingId === ad.id) reset(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const loadImage = (file?: File) => {
    if (!file) return;
    if (!/image\/(png|jpeg|webp)/u.test(file.type) || file.size > 500_000) {
      setError(english ? "Use a PNG, JPEG or WEBP image up to 500 KB." : "Выберите PNG, JPEG или WEBP до 500 КБ.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, imageData: String(reader.result), imageUrl: "" }));
    reader.readAsDataURL(file);
  };

  return <section className="admin-ads" aria-labelledby="admin-ads-title">
    <h2 id="admin-ads-title">{english ? "Today advertisements" : "Реклама в разделе «Сегодня»"}</h2>
    <p>{english ? "Drafts remain hidden. Publish an ad to show it as the second Today block to matching users." : "Черновики скрыты. Опубликованное объявление появится вторым блоком у подходящих пользователей."}</p>
    {error ? <p className="auth-error" role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <div className="admin-ads-list">
      {ads.map((ad) => <article key={ad.id}>
        <strong>{ad.title}</strong><span>{ad.enabled ? (english ? "Published" : "Опубликовано") : (english ? "Draft" : "Черновик")}</span>
        <button type="button" className="secondary-button" onClick={() => edit(ad)}>{english ? "Edit" : "Изменить"}</button>
        <button type="button" className="ghost-button" disabled={busy} onClick={() => void remove(ad)}>{english ? "Delete" : "Удалить"}</button>
      </article>)}
    </div>
    <form className="admin-ads-form" onSubmit={(event) => void save(event)}>
      <h3>{editingId ? (english ? "Edit advertisement" : "Изменить объявление") : (english ? "New advertisement" : "Новое объявление")}</h3>
      <label>{english ? "Title" : "Заголовок"}<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label>{english ? "Description" : "Описание"}<textarea required maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label>{english ? "Image file (PNG, JPEG, WEBP; up to 500 KB)" : "Картинка (PNG, JPEG, WEBP; до 500 КБ)"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => loadImage(event.target.files?.[0])} /></label>
      <label>{english ? "Or HTTPS image URL" : "Или HTTPS-ссылка на картинку"}<input type="url" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value, imageData: "" })} /></label>
      {(form.imageData || form.imageUrl) ? <img className="admin-ads-preview" src={form.imageData || form.imageUrl} alt="" /> : null}
      <label>{english ? "Destination HTTPS URL" : "HTTPS-ссылка объявления"}<input required type="url" value={form.linkUrl} onChange={(event) => setForm({ ...form, linkUrl: event.target.value })} /></label>
      <div className="admin-ads-fields">
        <label>{english ? "Languages (codes, empty = all)" : "Языки (коды, пусто = все)"}<input placeholder="ru, en" value={form.languages} onChange={(event) => setForm({ ...form, languages: event.target.value })} /></label>
        <label>{english ? "Device regions (ISO country codes, empty = all)" : "Регионы устройства (коды стран, пусто = все)"}<input placeholder="RU, UA" value={form.countries} onChange={(event) => setForm({ ...form, countries: event.target.value })} /></label>
        <label>{english ? "Start (device time)" : "Начало (время устройства)"}<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label>
        <label>{english ? "End (device time)" : "Окончание (время устройства)"}<input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label>
        <label>{english ? "Repeat after (hours)" : "Повторять через (часы)"}<input type="number" min={1} max={720} value={form.repeatHours} onChange={(event) => setForm({ ...form, repeatHours: Number(event.target.value) })} /></label>
        <label>{english ? "Priority (0–10)" : "Приоритет (0–10)"}<input type="number" min={0} max={10} value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })} /></label>
      </div>
      <fieldset><legend>{english ? "Platforms" : "Платформы"}</legend>
        {(["web", "android"] as const).map((platform) => <label key={platform}><input type="checkbox" checked={form.platforms.includes(platform)} onChange={(event) => setForm({ ...form, platforms: event.target.checked ? [...form.platforms, platform] : form.platforms.filter((item) => item !== platform) })} />{platform}</label>)}
      </fieldset>
      <label><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />{english ? "Publish" : "Опубликовать"}</label>
      <p>{english ? "Users can close the ad after 60 seconds of viewing. No ad is shown until published." : "Пользователь сможет закрыть рекламу через 60 секунд просмотра. До публикации она скрыта."}</p>
      <div className="admin-ads-actions"><button className="primary-button" type="submit" disabled={busy}>{busy ? "…" : (english ? "Save" : "Сохранить")}</button>
        {editingId ? <button type="button" className="secondary-button" onClick={reset}>{english ? "Cancel" : "Отмена"}</button> : null}</div>
    </form>
  </section>;
}
