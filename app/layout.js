import ClientProviders from './_components/ClientProviders';
import './globals.css';

export const metadata = {
  title: 'IKG studio dataset Manager'
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant-TW">
      <body>
        <ClientProviders>
          {children}
        </ClientProviders>
      </body>
    </html>
  );
}
