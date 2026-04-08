"use client";

import React from 'react';

function baseCalloutStyle(borderColor, background) {
  return {
    border: `1px solid ${borderColor}`,
    background,
    borderRadius: '12px',
    padding: '14px 16px',
    margin: '16px 0',
  };
}

export function Note({ title = 'Note', children }) {
  return (
    <div style={baseCalloutStyle('#2f7ff5', 'rgba(47,127,245,0.10)')}>
      <div style={{ fontSize: '12px', fontWeight: 800, color: '#9ec3ff', marginBottom: children ? '8px' : 0 }}>{title}</div>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function Warning({ title = 'Warning', children }) {
  return (
    <div style={baseCalloutStyle('#d97706', 'rgba(217,119,6,0.12)')}>
      <div style={{ fontSize: '12px', fontWeight: 800, color: '#f8c16d', marginBottom: children ? '8px' : 0 }}>{title}</div>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

function PlaceholderBox({ id, title, type, hint }) {
  return (
    <div style={{
      border: '1px dashed #47607f',
      background: 'rgba(12,24,43,0.78)',
      borderRadius: '14px',
      padding: '18px',
      margin: '18px 0',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <strong style={{ color: '#e6edf7' }}>{type} Placeholder</strong>
        <code style={{ color: '#9ba9c3', fontSize: '12px' }}>{id}</code>
      </div>
      <div style={{ marginTop: '8px', color: '#dce6f5', fontSize: '14px', fontWeight: 600 }}>{title}</div>
      <p style={{ margin: '8px 0 0', color: '#91a4c2', fontSize: '13px', lineHeight: 1.55 }}>{hint}</p>
    </div>
  );
}

export function ScreenshotPlaceholder({ id, title }) {
  return (
    <PlaceholderBox
      id={id}
      title={title}
      type="Screenshot"
      hint="Capture this screen after the workflow is stable. Show the full UI state relevant to the adjacent steps."
    />
  );
}

export function GifPlaceholder({ id, title }) {
  return (
    <PlaceholderBox
      id={id}
      title={title}
      type="GIF"
      hint="Record this motion workflow later. Keep the clip short and focused on one complete action path."
    />
  );
}

export function RelatedLinks({ items = [] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #25344d' }}>
      <h4 style={{ margin: '0 0 10px', color: '#e6edf7' }}>Related</h4>
      <ul style={{ margin: 0, paddingLeft: '20px', color: '#9ba9c3' }}>
        {items.map((item) => (
          <li key={item.href || item.label} style={{ marginBottom: '6px' }}>
            <a href={item.href} style={{ color: '#60a5fa' }}>{item.label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DocImage(props) {
  const { src = '', alt = '', ...rest } = props || {};
  return (
    <figure style={{ margin: '18px 0' }}>
      <img
        src={src}
        alt={alt}
        {...rest}
        style={{
          display: 'block',
          maxWidth: '100%',
          height: 'auto',
          borderRadius: '12px',
          border: '1px solid #25344d',
          background: '#0b1220',
        }}
      />
      {alt ? (
        <figcaption style={{ marginTop: '8px', color: '#91a4c2', fontSize: '12px', lineHeight: 1.5 }}>
          {alt}
        </figcaption>
      ) : null}
    </figure>
  );
}

export const mdxComponents = {
  Note,
  Warning,
  ScreenshotPlaceholder,
  GifPlaceholder,
  RelatedLinks,
  img: DocImage,
};
