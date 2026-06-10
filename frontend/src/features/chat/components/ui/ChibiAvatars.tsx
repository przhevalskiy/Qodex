import chibis from '@/assets/chibis.png';
import './ChibiAvatars.css';

// Sprite sheet is 4 cols × 4 rows
// background-size: 400% 400% maps each cell to the container
// position formula: col * (100/3)% horizontal, row * (100/3)% vertical
const AVATARS = [
  { label: 'Press Release',      col: 2, row: 0 },
  { label: 'Events',             col: 1, row: 1 },
  { label: 'Media & PR',         col: 0, row: 0 },
  { label: 'Social Media',       col: 0, row: 1 },
  { label: 'Thought Leadership', col: 3, row: 3 },
  { label: 'Web Services',       col: 1, row: 0 },
  { label: 'General',            col: 2, row: 1 },
];

function spritePos(col: number, row: number) {
  const x = col === 0 ? '0%' : col === 3 ? '100%' : `${(col / 3) * 100}%`;
  const y = row === 0 ? '0%' : row === 3 ? '100%' : `${(row / 3) * 100}%`;
  return `${x} ${y}`;
}

export function ChibiAvatars() {
  return (
    <div className="chibi-avatars">
      {AVATARS.map((avatar, i) => (
        <div
          key={avatar.label}
          className="chibi-avatar"
          title={avatar.label}
          style={{
            backgroundImage: `url(${chibis})`,
            backgroundPosition: spritePos(avatar.col, avatar.row),
            '--i': i,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
