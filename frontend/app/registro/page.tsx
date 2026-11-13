import type { Metadata } from 'next';
import { AuthForm } from '../_components/AuthForm';
export const metadata: Metadata = { title: 'Crear cuenta' };
export default function Page() { return <AuthForm mode="registro" />; }
