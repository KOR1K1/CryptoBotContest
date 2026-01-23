import { useLocation } from 'react-router-dom';
import FadeIn from '../ui/FadeIn';

const PageLayout = ({
  children,
  className = '',
  ...props
}) => {
  const location = useLocation();

  return (
    <FadeIn key={location.pathname} delay={0}>
      <div
        className={`max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 w-full overflow-x-hidden ${className}`}
        style={{ maxWidth: '100%' }}
        {...props}
      >
        {children}
      </div>
    </FadeIn>
  );
};

export default PageLayout;
