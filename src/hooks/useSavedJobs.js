import { useCallback, useEffect, useRef, useState } from 'react';
import { getSavedJobs, saveJob, unsaveJob } from '../api/savedJobs';

// One list request per view, not per card. Nothing is written to the public jobs cache.
export default function useSavedJobs() {
  const [state, setState] = useState({ token: null, jobs: [], loading: true, error: '' });
  const [actions, setActions] = useState({ token: null, busy: {}, messages: {}, feedback: '' });
  const version = useRef(0);
  const pending = useRef(new Set());
  const controller = useRef(null);
  const mounted = useRef(false);
  const token = localStorage.getItem('kaamonToken');

  const refresh = useCallback(async () => {
    const session = localStorage.getItem('kaamonToken');
    const requestVersion = ++version.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setState(current => ({ token: session, jobs: current.token === session ? current.jobs : [], loading: !!session, error: '' }));
    if (!session) return;
    try {
      const jobs = await getSavedJobs(session, controller.current.signal);
      if (mounted.current && requestVersion === version.current && session === localStorage.getItem('kaamonToken')) {
        setState({ token: session, jobs, loading: false, error: '' });
      }
    } catch (error) {
      if (mounted.current && requestVersion === version.current && session === localStorage.getItem('kaamonToken')) {
        setState(current => ({ ...current, loading: false, error: error.message }));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const onAuth = () => {
      setActions({ token: null, busy: {}, messages: {}, feedback: '' });
      refresh();
    };
    const onStorage = event => {
      if (event.key === 'kaamonToken' || event.key === null) onAuth();
    };
    refresh();
    window.addEventListener('kaamonAuthChanged', onAuth);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    window.addEventListener('karviamBlocksChanged', refresh);
    return () => {
      mounted.current = false;
      ++version.current;
      controller.current?.abort();
      window.removeEventListener('kaamonAuthChanged', onAuth);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('karviamBlocksChanged', refresh);
    };
  }, [refresh]);

  const jobs = state.token === token ? state.jobs : [];
  const savedIds = new Set(jobs.map(job => String(job.id)));

  async function toggle(jobId) {
    const session = localStorage.getItem('kaamonToken');
    const id = String(jobId);
    if (!session || session !== token || state.token !== session || state.loading || state.error) return;
    const key = `${session}:${id}`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    const wasSaved = savedIds.has(id);
    setActions(current => ({
      token: session,
      busy: { ...(current.token === session ? current.busy : {}), [id]: true },
      messages: { ...(current.token === session ? current.messages : {}), [id]: '' },
      feedback: '',
    }));
    try {
      const result = await (wasSaved ? unsaveJob : saveJob)(id, session);
      if (!mounted.current || session !== localStorage.getItem('kaamonToken')) return;
      // A list fetch started before this write must not undo its successful result.
      ++version.current;
      controller.current?.abort();
      setState(current => ({ ...current, loading: false, error: '', jobs: wasSaved
        ? current.jobs.filter(job => String(job.id) !== id)
        : [{ id }, ...current.jobs.filter(job => String(job.id) !== id)] }));
      setActions(current => ({ ...current, messages: { ...current.messages, [id]: result.message }, feedback: result.message }));
    } catch (error) {
      if (mounted.current && session === localStorage.getItem('kaamonToken')) {
        setActions(current => ({ ...current, messages: { ...current.messages, [id]: error.message }, feedback: error.message }));
      }
    } finally {
      pending.current.delete(key);
      if (mounted.current && session === localStorage.getItem('kaamonToken')) {
        setActions(current => ({ ...current, busy: { ...current.busy, [id]: false } }));
      }
    }
  }

  return {
    jobs, savedIds, toggle, refresh,
    loading: !!token && (state.token !== token || state.loading),
    error: state.token === token ? state.error : '',
    busy: actions.token === token ? actions.busy : {},
    messages: actions.token === token ? actions.messages : {},
    feedback: actions.token === token ? actions.feedback : '',
  };
}
