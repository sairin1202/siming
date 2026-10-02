import { useMemo, useState } from 'react';

import { CITIES } from '@/lib/cities.mjs';

import { InkSelect, type InkOption } from './ink-select';

export type BirthFormCardData = {
  kind: 'birth-form';
  prefill: { date?: string; time?: string | null; gender?: 'male' | 'female'; place?: string };
};

export type BirthFormValue = {
  calendar: 'solar' | 'lunar';
  year: number;
  month: number;
  day: number;
  leapMonth: boolean;
  time: string | null;
  gender: 'male' | 'female';
  place: string | null;
};

const SHICHEN = [
  ['子', '00:00', '23–1时'],
  ['丑', '02:00', '1–3时'],
  ['寅', '04:00', '3–5时'],
  ['卯', '06:00', '5–7时'],
  ['辰', '08:00', '7–9时'],
  ['巳', '10:00', '9–11时'],
  ['午', '12:00', '11–13时'],
  ['未', '14:00', '13–15时'],
  ['申', '16:00', '15–17时'],
  ['酉', '18:00', '17–19时'],
  ['戌', '20:00', '19–21时'],
  ['亥', '22:00', '21–23时'],
] as const;
const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_DAYS = (() => {
  const digits = '一二三四五六七八九十';
  return Array.from({ length: 30 }, (_, index) => {
    const day = index + 1;
    if (day <= 10) return `初${digits[day - 1]}`;
    if (day < 20) return `十${digits[day - 11]}`;
    if (day === 20) return '二十';
    if (day < 30) return `廿${digits[day - 21]}`;
    return '三十';
  });
})();
const pad = (value: number) => String(value).padStart(2, '0');
const HOURS: InkOption<number>[] = Array.from({ length: 24 }, (_, hour) => ({ value: hour, label: `${pad(hour)}时` }));
const MINUTES: InkOption<number>[] = Array.from({ length: 12 }, (_, index) => ({
  value: index * 5,
  label: `${pad(index * 5)}分`,
}));
const SHICHEN_OPTIONS: InkOption<string>[] = [
  ...SHICHEN.map(([name, value, range]) => ({ value, label: `${name}时`, sub: range })),
  { value: 'unknown', label: '不详' },
];
const PLACE_OPTIONS: InkOption<string>[] = [
  ...Object.keys(CITIES).map((name) => ({ value: name, label: name })),
  { value: '', label: '其他', sub: '不校时' },
];

/** The shichen whose two hours contain `time` (HH:MM), as its centre value. */
function shichenOf(time: string) {
  const hour = Number(time.slice(0, 2));
  return SHICHEN[Math.floor(((hour + 1) % 24) / 2)][1];
}

function Choices<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="bf-choices">
      {options.map(([option, label]) => (
        <button
          key={option}
          type="button"
          className={`bf-choice ${value === option ? 'is-on' : ''}`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Pick a birth date and hour instead of describing it: calendar, year, month,
 * day, shichen (or an exact time, or unknown), sex and birthplace.
 */
export function BirthForm({
  card,
  active,
  onSubmit,
}: {
  card: BirthFormCardData;
  active: boolean;
  onSubmit: (value: BirthFormValue, summary: string) => void;
}) {
  const thisYear = new Date().getFullYear();
  const [prefillYear, prefillMonth, prefillDay] = (card.prefill.date ?? '').split('-').map(Number);
  const prefillTime = card.prefill.time;
  const [calendar, setCalendar] = useState<'solar' | 'lunar'>('solar');
  const [year, setYear] = useState(prefillYear || 1995);
  const [month, setMonth] = useState(prefillMonth || 1);
  const [day, setDay] = useState(prefillDay || 1);
  const [leapMonth, setLeapMonth] = useState(false);
  const [shichen, setShichen] = useState<string | null>(
    prefillTime === null ? 'unknown' : prefillTime ? shichenOf(prefillTime) : null,
  );
  const [precise, setPrecise] = useState(false);
  const [hour, setHour] = useState(prefillTime ? Number(prefillTime.slice(0, 2)) : 8);
  const [minute, setMinute] = useState(prefillTime ? Math.round(Number(prefillTime.slice(3, 5)) / 5) * 5 % 60 : 0);
  const [gender, setGender] = useState<'male' | 'female' | null>(card.prefill.gender ?? null);
  const [place, setPlace] = useState(card.prefill.place && card.prefill.place in CITIES ? card.prefill.place : '');

  const daysInMonth = useMemo(
    () => (calendar === 'lunar' ? 30 : new Date(year, month, 0).getDate()),
    [calendar, year, month],
  );
  const safeDay = Math.min(day, daysInMonth);

  const yearOptions = useMemo<InkOption<number>[]>(
    () => Array.from({ length: thisYear - 1929 }, (_, index) => thisYear - index).map((value) => ({ value, label: `${value}` })),
    [thisYear],
  );
  const monthOptions: InkOption<number>[] = Array.from({ length: 12 }, (_, index) => ({
    value: index + 1,
    label: calendar === 'lunar' ? `${LUNAR_MONTHS[index]}月` : `${index + 1}月`,
  }));
  const dayOptions: InkOption<number>[] = Array.from({ length: daysInMonth }, (_, index) => ({
    value: index + 1,
    label: calendar === 'lunar' ? LUNAR_DAYS[index] : `${index + 1}`,
  }));

  const time = precise ? `${pad(hour)}:${pad(minute)}` : shichen === 'unknown' ? null : shichen ?? undefined;
  const ready = Boolean(gender) && time !== undefined;

  const submit = () => {
    if (!ready || !gender || time === undefined) return;
    const dateText =
      calendar === 'lunar'
        ? `农历${year}年${leapMonth ? '闰' : ''}${LUNAR_MONTHS[month - 1]}月${LUNAR_DAYS[safeDay - 1]}`
        : `${year}年${month}月${safeDay}日`;
    const hourText =
      time === null ? '时辰不详' : precise ? time : `${SHICHEN.find(([, value]) => value === time)?.[0]}时`;
    const summary = [dateText, hourText, gender === 'male' ? '男' : '女', place].filter(Boolean).join(' ');
    onSubmit({ calendar, year, month, day: safeDay, leapMonth, time, gender, place: place || null }, summary);
  };

  return (
    <form
      className="card birth-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="card-kicker">生辰帖</p>
      <fieldset disabled={!active}>
        <div className="bf-row">
          <span className="bf-label">历</span>
          <Choices
            value={calendar}
            options={[
              ['solar', '公历'],
              ['lunar', '农历'],
            ]}
            onChange={setCalendar}
          />
        </div>

        <div className="bf-row">
          <span className="bf-label">日</span>
          <div className="bf-line">
            <InkSelect label="年" value={year} options={yearOptions} onChange={setYear} columns={4} disabled={!active} />
            <span className="bf-unit">年</span>
            <InkSelect label="月" value={month} options={monthOptions} onChange={setMonth} columns={3} disabled={!active} />
            <InkSelect label="日" value={safeDay} options={dayOptions} onChange={setDay} columns={calendar === 'lunar' ? 5 : 7} disabled={!active} />
            {calendar === 'solar' && <span className="bf-unit">日</span>}
            {calendar === 'lunar' && (
              <button
                type="button"
                className={`bf-choice small ${leapMonth ? 'is-on' : ''}`}
                aria-pressed={leapMonth}
                onClick={() => setLeapMonth((value) => !value)}
              >
                闰月
              </button>
            )}
          </div>
        </div>

        <div className="bf-row">
          <span className="bf-label">时</span>
          <div className="bf-line">
            {precise ? (
              <>
                <InkSelect label="时" value={hour} options={HOURS} onChange={setHour} columns={4} disabled={!active} />
                <InkSelect label="分" value={minute} options={MINUTES} onChange={setMinute} columns={4} disabled={!active} />
              </>
            ) : (
              <InkSelect
                label="时辰"
                value={shichen}
                options={SHICHEN_OPTIONS}
                onChange={setShichen}
                columns={3}
                placeholder="择时辰"
                disabled={!active}
              />
            )}
            <button
              type="button"
              className={`bf-choice small ${precise ? 'is-on' : ''}`}
              aria-pressed={precise}
              onClick={() => setPrecise((value) => !value)}
            >
              精确到分
            </button>
          </div>
        </div>

        <div className="bf-row">
          <span className="bf-label">性</span>
          <Choices
            value={gender}
            options={[
              ['male', '男'],
              ['female', '女'],
            ]}
            onChange={setGender}
          />
        </div>

        <div className="bf-row">
          <span className="bf-label">地</span>
          <div className="bf-line">
            <InkSelect
              label="出生地"
              value={place}
              options={PLACE_OPTIONS}
              onChange={setPlace}
              columns={4}
              disabled={!active}
            />
          </div>
        </div>

        <div className="bf-submit">
          <button type="submit" className="bf-seal" disabled={!ready}>
            定
          </button>
        </div>
      </fieldset>
    </form>
  );
}
