import React, { memo } from 'react';
import { Tag } from 'antd';
import { RightOutlined, DownOutlined } from '@ant-design/icons';
import type { ProcessedLogGroup } from '@/utils/smartLog';
import { highlightJSON } from '@/utils/smartLog';

interface SmartLogLineProps {
  group: ProcessedLogGroup;
  onToggle: (id: string) => void;
  searchKeyword?: string;
}

const escapeHtml = (str: string): string => {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

const highlightKeyword = (text: string, keyword: string): string => {
  if (!keyword) return escapeHtml(text);
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedKeyword})`, 'gi');
  return escapeHtml(text).replace(regex, '<mark class="log-highlight">$1</mark>');
};

const SmartLogLine: React.FC<SmartLogLineProps> = ({ group, onToggle, searchKeyword = '' }) => {
  const { id, type, content, lines, collapsed, repeatCount, formattedContent, matchPattern, stackPreview } = group;
  const isFoldable = type !== 'single';
  const lineType = lines[0]?.type || 'stdout';

  const renderContent = () => {
    if (type === 'json') {
      if (collapsed) {
        return (
          <span className="log-content">
            {highlightKeyword(content.length > 100 ? content.substring(0, 100) + '...' : content, searchKeyword)}
          </span>
        );
      }
      return (
        <pre
          className="log-json-content"
          dangerouslySetInnerHTML={{ __html: formattedContent || highlightJSON(content) }}
        />
      );
    }

    if (type === 'stacktrace' && stackPreview) {
      if (collapsed) {
        return (
          <div className="log-content">
            <div className="stack-preview">
              {stackPreview.head.map((line, idx) => (
                <div key={idx} className="stack-line" dangerouslySetInnerHTML={{ __html: highlightKeyword(line, searchKeyword) }} />
              ))}
              <div className="stack-fold-indicator">
                <Tag color="orange" style={{ margin: '4px 0' }}>
                  隐藏中间 {stackPreview.hiddenCount} 行堆栈信息，点击展开
                </Tag>
              </div>
              {stackPreview.tail.map((line, idx) => (
                <div key={idx} className="stack-line" dangerouslySetInnerHTML={{ __html: highlightKeyword(line, searchKeyword) }} />
              ))}
            </div>
          </div>
        );
      }
      return (
        <div className="log-content">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className={`log-line ${line.type}`}
              dangerouslySetInnerHTML={{ __html: highlightKeyword(line.content, searchKeyword) }}
            />
          ))}
        </div>
      );
    }

    if (type === 'duplicate' || type === 'regex') {
      if (collapsed) {
        return (
          <span className="log-content">
            <Tag color={type === 'regex' ? 'purple' : 'blue'} style={{ marginRight: 8 }}>
              {type === 'regex' ? matchPattern : '重复'} ×{repeatCount}
            </Tag>
            <span dangerouslySetInnerHTML={{ __html: highlightKeyword(content, searchKeyword) }} />
          </span>
        );
      }
      return (
        <div className="log-content">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className={`log-line ${line.type}`}
              dangerouslySetInnerHTML={{ __html: highlightKeyword(line.content, searchKeyword) }}
            />
          ))}
        </div>
      );
    }

    return (
      <span
        className="log-content"
        dangerouslySetInnerHTML={{ __html: highlightKeyword(content, searchKeyword) }}
      />
    );
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isFoldable) {
      e.stopPropagation();
      onToggle(id);
    }
  };

  return (
    <div
      className={`smart-log-line ${lineType} ${isFoldable ? 'foldable' : ''} ${collapsed ? 'collapsed' : 'expanded'} log-type-${type}`}
      onClick={handleClick}
    >
      {isFoldable && (
        <span className="fold-icon">
          {collapsed ? <RightOutlined /> : <DownOutlined />}
        </span>
      )}
      {!isFoldable && <span className="fold-icon-placeholder" />}
      {renderContent()}
    </div>
  );
};

export default memo(SmartLogLine);
