import { useEffect, useRef, useState } from 'react';
import {
  inspectSourceRecovery,
  performSourceRecovery,
  type SourceRecoveryPlan,
} from '../api/directAuthRecovery';
import {
  inspectRebootstrap,
  performRebootstrap,
  type RebootstrapPlan,
} from '../api/directAuthRebootstrap';
import { directAuthVersion } from '../api/directAuthSessionState';
import type { LoginSuccessResponse } from '../api/loginTypes';

type Options = {
  onLoginSuccess?: (response: LoginSuccessResponse) => void;
  onReleased: () => void;
  onMessage: (message: string) => void;
};

export function useDirectLoginRecovery(options: Options) {
  const [sourcePlan, setSourcePlan] = useState<SourceRecoveryPlan | null>(null);
  const [bootstrapPlan, setBootstrapPlan] = useState<RebootstrapPlan | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const inspectActions = async () => {
    if (!active.current || busy.current) return false;
    setSourcePlan(null);
    setBootstrapPlan(null);
    const version = directAuthVersion();
    const [source, bootstrap] = await Promise.allSettled([
      inspectSourceRecovery(),
      inspectRebootstrap(),
    ]);
    if (active.current && version === directAuthVersion()) {
      setSourcePlan(source.status === 'fulfilled' ? source.value : null);
      setBootstrapPlan(bootstrap.status === 'fulfilled' ? bootstrap.value : null);
      return Boolean(
        (source.status === 'fulfilled' && source.value) ||
        (bootstrap.status === 'fulfilled' && bootstrap.value),
      );
    }
    return false;
  };

  const runAction = async (kind: 'source' | 'rebootstrap') => {
    if (busy.current) return;
    const plan = kind === 'source' ? sourcePlan : bootstrapPlan;
    if (!plan || plan.version !== directAuthVersion()) return;
    busy.current = true;
    setIsRecovering(true);
    setSourcePlan(null);
    setBootstrapPlan(null);
    let ownedVersion = plan.version;
    const onIntent = (version: number) => {
      ownedVersion = version;
    };
    try {
      const result =
        kind === 'source'
          ? await performSourceRecovery(plan as SourceRecoveryPlan, onIntent)
          : await performRebootstrap(plan as RebootstrapPlan, onIntent);
      if (!active.current || result.version !== directAuthVersion()) return;
      options.onMessage(result.message);
      if ('success' in result && result.success) options.onLoginSuccess?.(result.success);
      if ('released' in result && result.released) options.onReleased();
    } catch {
      if (active.current && ownedVersion === directAuthVersion())
        options.onMessage('인증 복구 결과를 확인하지 못했어요. 상태를 다시 확인해 주세요.');
    } finally {
      busy.current = false;
      if (active.current) setIsRecovering(false);
    }
  };

  return {
    inspectActions,
    recoverSource: () => runAction('source'),
    rebootstrap: () => runAction('rebootstrap'),
    canRecoverSource: Boolean(sourcePlan),
    canRebootstrap: Boolean(bootstrapPlan),
    isRecovering,
  };
}
