import { redirect } from 'next/navigation';
import { STUDY_ENABLED } from '@/lib/features';
import Study from './study-client';

export default function StudyPage() {
  if (!STUDY_ENABLED) redirect('/');
  return <Study />;
}
