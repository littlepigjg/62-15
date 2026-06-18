import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Input,
  Button,
  Space,
  Tooltip,
  Modal,
  Form,
  Switch,
  List,
  Popover,
  Tag,
  App,
  Divider,
} from 'antd';
import {
  SearchOutlined,
  DownSquareOutlined,
  UpSquareOutlined,
  FilterOutlined,
  PlusOutlined,
  DeleteOutlined,
  SettingOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import SmartLogLine from './SmartLogLine';
import type { ProcessedLogGroup, FoldPattern } from '@/utils/smartLog';
import {
  processLogs,
  loadFoldState,
  saveFoldState,
  loadFoldPatterns,
  saveFoldPatterns,
  DEFAULT_FOLD_PATTERNS,
  generateId,
} from '@/utils/smartLog';

interface SmartLogViewerProps {
  stdout: string;
  stderr: string;
  storageKey?: string;
  showToolbar?: boolean;
  autoScroll?: boolean;
  className?: string;
}

const MAX_PROCESS_LINES = 5000;

const SmartLogViewer: React.FC<SmartLogViewerProps> = ({
  stdout,
  stderr,
  storageKey = 'default',
  showToolbar = true,
  autoScroll = true,
  className = '',
}) => {
  const { message } = App.useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [patterns, setPatterns] = useState<FoldPattern[]>([]);
  const [patternModalOpen, setPatternModalOpen] = useState(false);
  const [form] = Form.useForm();
  const prevProcessedRef = useRef<ProcessedLogGroup[]>([]);

  useEffect(() => {
    const saved = loadFoldState(storageKey);
    setCollapsedIds(new Set(saved));
    setPatterns(loadFoldPatterns());
  }, [storageKey]);

  useEffect(() => {
    saveFoldState(storageKey, Array.from(collapsedIds));
  }, [collapsedIds, storageKey]);

  useEffect(() => {
    if (patterns.length > 0) {
      saveFoldPatterns(patterns);
    }
  }, [patterns]);

  const processedGroups = useMemo(() => {
    const totalLines = (stdout ? stdout.split('\n').length : 0) + (stderr ? stderr.split('\n').length : 0);
    if (totalLines > MAX_PROCESS_LINES) {
      const stdoutLines = stdout ? stdout.split('\n') : [];
      const stderrLines = stderr ? stderr.split('\n') : [];
      const halfLimit = Math.floor(MAX_PROCESS_LINES / 2);
      const truncatedStdout = stdoutLines.slice(0, halfLimit).join('\n');
      const truncatedStderr = stderrLines.slice(0, halfLimit).join('\n');
      const result = processLogs(truncatedStdout, truncatedStderr, patterns, collapsedIds);
      if (totalLines > MAX_PROCESS_LINES) {
        result.push({
          id: `truncated-${generateId()}`,
          type: 'single',
          content: `--- 日志过长，仅显示前 ${MAX_PROCESS_LINES} 行，共 ${totalLines} 行 ---`,
          lines: [],
          collapsed: false,
        });
      }
      prevProcessedRef.current = result;
      return result;
    }
    const result = processLogs(stdout, stderr, patterns, collapsedIds);
    prevProcessedRef.current = result;
    return result;
  }, [stdout, stderr, patterns, collapsedIds]);

  const filteredGroups = useMemo(() => {
    if (!searchKeyword) return processedGroups;
    const kw = searchKeyword.toLowerCase();
    return processedGroups.filter(group =>
      group.lines.some(line => line.content.toLowerCase().includes(kw))
    );
  }, [processedGroups, searchKeyword]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [stdout, stderr, autoScroll]);

  const handleToggle = useCallback((id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setCollapsedIds(new Set());
    message.success('已展开全部');
  }, [message]);

  const handleFoldAll = useCallback(() => {
    const foldableIds = processedGroups
      .filter(g => g.type !== 'single')
      .map(g => g.id);
    setCollapsedIds(new Set(foldableIds));
    message.success('已折叠全部');
  }, [processedGroups, message]);

  const handleAddPattern = useCallback((values: { name: string; pattern: string }) => {
    try {
      new RegExp(values.pattern);
    } catch {
      message.error('正则表达式格式不正确');
      return;
    }
    const newPattern: FoldPattern = {
      id: generateId(),
      name: values.name,
      pattern: values.pattern,
      enabled: true,
    };
    setPatterns(prev => [...prev, newPattern]);
    form.resetFields();
    message.success('已添加折叠规则');
  }, [form, message]);

  const handleTogglePattern = useCallback((id: string) => {
    setPatterns(prev => prev.map(p =>
      p.id === id ? { ...p, enabled: !p.enabled } : p
    ));
  }, []);

  const handleDeletePattern = useCallback((id: string) => {
    setPatterns(prev => prev.filter(p => p.id !== id));
    message.success('已删除规则');
  }, [message]);

  const handleResetPatterns = useCallback(() => {
    setPatterns([...DEFAULT_FOLD_PATTERNS]);
    message.success('已重置为默认规则');
  }, [message]);

  const stats = useMemo(() => {
    const total = processedGroups.reduce((sum, g) => sum + g.lines.length, 0);
    const hidden = processedGroups
      .filter(g => g.collapsed && g.type !== 'single')
      .reduce((sum, g) => sum + (g.lines.length - 1), 0);
    const jsonCount = processedGroups.filter(g => g.type === 'json').length;
    const stackCount = processedGroups.filter(g => g.type === 'stacktrace').length;
    const dupCount = processedGroups.filter(g => g.type === 'duplicate').length;
    const regexCount = processedGroups.filter(g => g.type === 'regex').length;
    return { total, hidden, jsonCount, stackCount, dupCount, regexCount };
  }, [processedGroups]);

  const patternModalContent = (
    <Form form={form} layout="vertical" onFinish={handleAddPattern}>
      <Form.Item
        name="name"
        label="规则名称"
        rules={[{ required: true, message: '请输入规则名称' }]}
      >
        <Input placeholder="例如：心跳日志" />
      </Form.Item>
      <Form.Item
        name="pattern"
        label="正则表达式"
        rules={[{ required: true, message: '请输入正则表达式' }]}
        extra="匹配该表达式的连续日志行将被自动折叠"
      >
        <Input placeholder="例如：.*heartbeat.*" />
      </Form.Item>
      <Form.Item>
        <Button type="primary" htmlType="submit" icon={<PlusOutlined />} block>
          添加规则
        </Button>
      </Form.Item>
      <Divider style={{ margin: '12px 0' }} />
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        <List
          dataSource={patterns}
          renderItem={(item) => (
            <List.Item
              key={item.id}
              actions={[
                <Switch
                  size="small"
                  checked={item.enabled}
                  onChange={() => handleTogglePattern(item.id)}
                />,
                <Button
                  size="small"
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() => handleDeletePattern(item.id)}
                />,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span>{item.name}</span>
                    <Tag color={item.enabled ? 'green' : 'default'}>
                      {item.enabled ? '启用' : '禁用'}
                    </Tag>
                  </Space>
                }
                description={<code style={{ fontSize: 11 }}>{item.pattern}</code>}
              />
            </List.Item>
          )}
        />
      </div>
      {patterns.length > 0 && (
        <Button
          style={{ marginTop: 12 }}
          block
          onClick={handleResetPatterns}
        >
          重置为默认规则
        </Button>
      )}
    </Form>
  );

  const statsPopover = (
    <div style={{ fontSize: 12, minWidth: 180 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>日志统计</strong>
      </div>
      <div>总行数: {stats.total}</div>
      <div>已折叠: {stats.hidden} 行</div>
      {stats.jsonCount > 0 && <div>JSON格式: {stats.jsonCount} 个</div>}
      {stats.stackCount > 0 && <div>堆栈跟踪: {stats.stackCount} 个</div>}
      {stats.dupCount > 0 && <div>重复日志: {stats.dupCount} 组</div>}
      {stats.regexCount > 0 && <div>规则匹配: {stats.regexCount} 组</div>}
    </div>
  );

  return (
    <div className={`smart-log-viewer ${className}`}>
      {showToolbar && (
        <div className="smart-log-toolbar">
          <Space size="small" wrap>
            <Input
              size="small"
              prefix={<SearchOutlined />}
              placeholder="搜索日志内容"
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
              style={{ width: 200 }}
              allowClear
            />
            <Tooltip title="展开全部">
              <Button size="small" icon={<DownSquareOutlined />} onClick={handleExpandAll} />
            </Tooltip>
            <Tooltip title="折叠全部">
              <Button size="small" icon={<UpSquareOutlined />} onClick={handleFoldAll} />
            </Tooltip>
            <Tooltip title="折叠规则设置">
              <Button
                size="small"
                icon={<FilterOutlined />}
                onClick={() => setPatternModalOpen(true)}
              />
            </Tooltip>
            <Popover content={statsPopover} placement="bottomRight">
              <Button size="small" icon={<InfoCircleOutlined />}>
                {stats.hidden > 0 && (
                  <Tag color="blue" style={{ marginLeft: 4 }}>
                    已隐藏 {stats.hidden} 行
                  </Tag>
                )}
              </Button>
            </Popover>
          </Space>
        </div>
      )}

      <div className="smart-log-content" ref={containerRef}>
        {filteredGroups.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#666' }}>
            {searchKeyword ? '未找到匹配的日志' : '暂无输出'}
          </div>
        ) : (
          filteredGroups.map(group => (
            <SmartLogLine
              key={group.id}
              group={group}
              onToggle={handleToggle}
              searchKeyword={searchKeyword}
            />
          ))
        )}
      </div>

      <Modal
        title={
          <Space>
            <SettingOutlined />
            <span>智能折叠规则设置</span>
          </Space>
        }
        open={patternModalOpen}
        onCancel={() => setPatternModalOpen(false)}
        footer={null}
        width={500}
        destroyOnClose
      >
        {patternModalContent}
      </Modal>
    </div>
  );
};

export default SmartLogViewer;
