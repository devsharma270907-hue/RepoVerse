import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';

export function NotFoundPage() {
  return (
    <div className="not-found">
      <span className="not-found__icon">
        <Icon name="graph" size={40} />
      </span>
      <p className="not-found__code">404</p>
      <h1>This node is not in the graph</h1>
      <p>The page you asked for does not exist, or it belongs to a repository you cannot access.</p>
      <Link to="/" className="btn btn--primary btn--md">
        <Icon name="repo" size={16} /> Back to repositories
      </Link>
    </div>
  );
}
