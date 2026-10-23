// Tiny trend line. Missing points break the line so outages stay visible.

interface Props {
  values: (number | null)[];
  color?: string;
  height?: number;
}

export function Sparkline({ values, color = '#38bdf8', height = 36 }: Props) {
  const width = 160;
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" />;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const segments: string[] = [];
  let current = '';
  values.forEach((v, i) => {
    if (v == null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    const x = (i / (values.length - 1)) * width;
    const y = height - 3 - ((v - min) / span) * (height - 6);
    current += `${current ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
  });
  if (current) segments.push(current);
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {segments.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}
