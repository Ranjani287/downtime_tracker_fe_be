import { useTheme } from '../theme.jsx';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="btn secondary theme-toggle" onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span> {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
