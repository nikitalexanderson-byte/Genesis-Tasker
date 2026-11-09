import RU from '../texts.ru.json';
import { ORDINARY_GREEK } from '../greek';
export type SphragisRecord = {
    id: string;
    letter: string;
    name: string;
    association: string;
    intentTags: string[];
    seated: string;
    gesture: string;
    withoutHands: string;
    visual: string;
    sourceRefs: string[];
    contentVersion: string;
};
const rows: readonly [
    string,
    string,
    string,
    string[],
    string
][] = [
    ['Α', RU.text1536, RU.text1537, ['initiative', 'action'], RU.text1538],
    ['Β', RU.text1539, RU.text1540, ['care', 'belonging'], RU.text1541],
    ['Γ', RU.text1542, RU.text1543, ['clarity', 'strategy'], RU.text1544],
    ['Δ', RU.text1545, RU.text1546, ['clarity', 'fact'], RU.text1547],
    ['Ε', RU.text1548, RU.text1549, ['exchange', 'request'], RU.text1550],
    ['Ζ', RU.text1551, RU.text1552, ['creativity', 'initiative'], RU.text1553],
    ['Η', RU.text1554, RU.text1555, ['agreement', 'reciprocity'], RU.text1556],
    ['Θ', RU.text1557, RU.text1558, ['measure', 'pause'], RU.text1559],
    ['Ι', RU.text1560, RU.text1561, ['action', 'completion'], RU.text1562],
    ['Κ', RU.text1563, RU.text0178, ['strategy', 'clarity'], RU.text1564],
    ['Λ', RU.text1565, RU.text1566, ['care', 'feeling'], RU.text1567],
    ['Μ', RU.text1568, RU.text1569, ['care', 'stability'], RU.text1570],
    ['Ν', RU.text1571, RU.text1572, ['rhythm', 'completion'], RU.text1573],
    ['Ξ', RU.text1574, RU.text1575, ['clarity', 'measure'], RU.text1576],
    ['Ο', RU.text1577, RU.text1578, ['belonging', 'stability'], RU.text1579],
    ['Π', RU.text1580, RU.text0015, ['boundary', 'protection'], RU.text1581],
    ['Ρ', RU.text1582, RU.text1583, ['initiative', 'action'], RU.text1584],
    ['Σ', RU.text1585, RU.text1586, ['completion', 'clarity'], RU.text1587],
    ['Τ', RU.text1588, RU.text0031, ['stability', 'rhythm'], RU.text1589],
    ['Υ', RU.text1590, RU.text1591, ['strategy', 'initiative'], RU.text1592],
    ['Φ', RU.text1593, RU.text1594, ['measure', 'reciprocity'], RU.text1595],
    ['Χ', RU.text1596, RU.text1597, ['exchange', 'creativity'], RU.text1598],
    ['Ψ', RU.text1599, RU.text0032, ['expression', 'feeling'], RU.text1600],
    ['Ω', RU.text1601, RU.text0027, ['completion', 'rhythm'], RU.text1602],
];
export const SPHRAGISES: readonly SphragisRecord[] = rows.map(([letter, name, association, intentTags, gesture]) => ({
    id: `sphragis-${ORDINARY_GREEK.indexOf(letter) + 1}`, letter, name, association, intentTags,
    seated: RU.text1603,
    gesture: (RU.text1604 + (gesture[0].toLocaleLowerCase('ru') + gesture.slice(1)) + RU.text1605),
    withoutHands: (RU.text1606 + letter + RU.text1607),
    visual: (RU.text1608 + letter + RU.text1609),
    sourceRefs: ['project:accessible-letter-practice-v1'], contentVersion: 'aurora-sphragis-v1',
}));
if (SPHRAGISES.length !== 24 || new Set(SPHRAGISES.map(s => s.letter)).size !== 24)
    throw new Error('AURORA_SPHRAGIS_COVERAGE');
