import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'마음 | 명절 선물 연구실',description:'한국어 명절 선물 대화의 조건 갱신과 변경 표시를 살펴보는 연구 데모'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>}
