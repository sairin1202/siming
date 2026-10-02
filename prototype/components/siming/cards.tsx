import type { BirthFormCardData } from './birth-form';
import type { GuaCardData } from './ritual';
import { toHanNumerals } from './writing';

export type BirthCardData = {
  kind: 'birth';
  solar: string;
  lunar: string;
  time: string | null;
  shichen: string | null;
  gender: string;
  place: string | null;
};

export type ChartCardData = {
  kind: 'chart';
  pillars: Array<string | null>;
  dayMaster: string;
  strength: string;
  elements: Record<string, number>;
  favorable: string[];
  dayun: string | null;
  hourKnown: boolean;
};

export type DaysCardData = {
  kind: 'days';
  question: string | null;
  days: Array<{ date: string; ganzhi: string; reasons: string[] }>;
};

/** An invitation to still the mind and throw the coins. */
export type CastCardData = { kind: 'cast' };

/** The two ways in: 起卦 or 观命. */
export type ModesCardData = { kind: 'modes' };

export type CardData =
  | BirthCardData
  | BirthFormCardData
  | ChartCardData
  | CastCardData
  | GuaCardData
  | ModesCardData
  | DaysCardData;


export function monthText(month: string) {
  const [year, value] = month.split('-').map(Number);
  return `${year}年${value}月`;
}

/** A slip of paper written in vertical columns, right to left, with no box around it. */
export function BirthCard({
  card,
  active,
  onConfirm,
  onEdit,
}: {
  card: BirthCardData;
  active: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  const columns: Array<[string, string]> = [
    ['公历', toHanNumerals(card.solar)],
    ['', card.lunar],
    ['时辰', card.time ? (card.shichen ?? toHanNumerals(card.time)) : '不详'],
    ['', card.gender === '男' ? '乾造' : '坤造'],
    ['生地', card.place ?? '未书'],
  ];
  return (
    <div className="slip-wrap">
      <div className="slip birth-slip">
        <p className="slip-title">生辰帖</p>
        {columns.map(([label, value]) => (
          <p key={label + value} className="slip-col">
            {label && <small>{label}</small>}
            <span>{value}</span>
          </p>
        ))}
      </div>
      {active && (
        <div className="slip-seals">
          <button type="button" className="ink-seal" onClick={onConfirm} aria-label="是的">
            是
          </button>
          <button type="button" className="ink-seal is-light" onClick={onEdit} aria-label="要改">
            改
          </button>
        </div>
      )}
    </div>
  );
}

/** Three good days, each a column: the day's 干支 in large brush, its date, and why. */
export function DaysCard({ card }: { card: DaysCardData }) {
  return (
    <div className="slip days-slip" aria-label="吉日">
      {card.days.map((day) => {
        const [, month, date] = day.date.split('-').map(Number);
        return (
          <p key={day.date} className="slip-col">
            <span className="slip-big">{day.ganzhi}</span>
            <span>{toHanNumerals(`${month}月${date}日`)}</span>
            <small className="slip-note">{day.reasons.join(' ')}</small>
          </p>
        );
      })}
    </div>
  );
}
