"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import { useDialogAccessibility } from "./use-dialog-accessibility";
export default function SacredYearDetailsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialogAccessibility<HTMLElement>(onClose, true);
  return (
        <div className="modal-backdrop sacred-year-details-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <section ref={dialogRef} className="sacred-year-details-modal" role="dialog" aria-modal="true" aria-labelledby="sacred-year-details-title" aria-describedby="sacred-year-details-intro" tabIndex={-1}>
            <DialogCloseButton type="button" className="modal-close sacred-year-details-close" onClick={() => onClose()} aria-label="Закрыть описание сакрального года" />
            <header className="sacred-year-details-header">
              <span className="sacred-year-details-sigil" aria-hidden="true">✦</span>
              <div>
                <span className="eyebrow">Сакральная геометрия времени</span>
                <h2 id="sacred-year-details-title">Почему наш год устроен именно так?</h2>
              </div>
            </header>

            <div className="sacred-year-details-lead" id="sacred-year-details-intro">
              <p>Почему наш год начинается в день весеннего равноденствия? Почему в месяце ровно 30 дней, разбитых на 6 «пят» (пятидневок), а самих месяцев 12, плюс «скрытый» 13-й месяц?</p>
              <p>Это не случайность. Это классическая сакральная геометрия времени, где каждый день — это шаг в процессе эволюции духа. Давайте разберём эту структуру через оптику античной теологии Пифагора, Гесиода и Гомера.</p>
            </div>

            <div className="sacred-year-details-sections">
              <article className="sacred-year-details-section equinox">
                <span className="sacred-year-section-symbol" aria-hidden="true">🌱</span>
                <div>
                  <h3>Почему год начинается в весеннее равноденствие?</h3>
                  <p>20 марта — это точка преодоления инерции зимы. Это первый день месяца Арейос (Арес), время прорыва, отделения бытия от небытия и победы света над тьмой. 12 месяцев — это полный солярный круг, совершенный цикл развития идеи от её зарождения весной до полного растворения в пустоте (Зофос) в конце зимы. А оставшиеся 5–6 дней года — это Апейрон, время чистого Хаоса вне времени, когда старый мир рухнул, а новый ещё не рождён.</p>
                </div>
              </article>

              <article className="sacred-year-details-section pentad">
                <span className="sacred-year-section-symbol" aria-hidden="true">🖐</span>
                <div>
                  <h3>Пентада: 5 стихий и геометрия восхождения</h3>
                  <p>Каждая Пята (5 дней) — это микрокосм, отражающий процесс «Анабасиса» (восхождения) души от плотной материи к чистому свету. Дни идут в строгом порядке: Земля — Вода — Воздух — Огонь — Эфир. Почему именно так?</p>
                  <div className="sacred-year-source-grid">
                    <div>
                      <strong>Пифагор</strong>
                      <span>Геометрия плотности</span>
                      <p>Мир строится от стабильного к тонкому. Земля — это статика (куб), Вода — текучесть, Воздух — форма. Огонь стоит выше Воздуха, потому что Воздух пассивен, а Огонь активен — он трансформирует элементы, преодолевая гравитацию. Эфир — это квинтэссенция, венец творения.</p>
                    </div>
                    <div>
                      <strong>Гесиод</strong>
                      <span>Хронология творения</span>
                      <p>В его «Теогонии» путь творения идёт от тяжести к сиянию. Сначала Хаос и твёрдая Земля (Гея), затем из неё выделяется Вода (Понт), Землю покрывает Небо (Воздух / Уран), и лишь затем рождается чистый Свет (Эфир). Огонь здесь — инструмент богов, стоящий над стихиями.</p>
                    </div>
                    <div>
                      <strong>Гомер</strong>
                      <span>Раздел мира</span>
                      <p>Иерархия строится на жребии богов. Аид получил недра (Земля), Посейдон — море (Вода), а Зевс — высокое небо (Воздух и Эфир). Движение всегда идёт снизу вверх.</p>
                    </div>
                  </div>
                  <p className="sacred-year-details-thesis"><strong>Успех любого дела требует пройти эти 5 шагов: от «заземления» идеи до её «одухотворения» в эфире.</strong></p>
                </div>
              </article>

              <article className="sacred-year-details-section hexad">
                <span className="sacred-year-section-symbol" aria-hidden="true">🎲</span>
                <div>
                  <h3>Гексада: 6 Пят и Куб Событий</h3>
                  <p>Если Пята — это инструмент (стихии), то Гексада (число 6) — это рамка времени, в которой этот инструмент действует. 6 пят образуют 30 дней месяца.</p>
                  <p>Для пифагорейцев 6 — это первое совершенное число (1 + 2 + 3 = 6), число «сотворения мира» и гармонии. Также 6 — это число граней куба, самой устойчивой фигуры. 6 Пят — это 6 сторон «событийного куба» месяца. Пока не пройдёшь все 6, не увидишь объёмную картину.</p>
                  <p>У Гесиода это 6 поколений теогонии и веков творения.</p>
                  <p>У Гомера — 6 граней эпического «Агона» (пути героя).</p>
                </div>
              </article>
            </div>
          </section>
        </div>
  );
}
