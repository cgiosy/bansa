import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { $, createScope, DerivedAtom, type ThenableSignal } from '../src/index';

const flushMicrotasks = () =>
	new Promise((resolve) => {
		const { port1, port2 } = new MessageChannel();
		port1.onmessage = resolve;
		port2.postMessage(null);
	});
const wait = () =>
	new Promise((resolve) => {
		setTimeout(resolve, 4);
	});

const inc = (x: number) => x + 1;
const nop = () => {};
const nops = (): (() => void)[] => [];

describe('Atom Library - Basic Tests', () => {
	it('primitive atom', async () => {
		const atom = $(42);
		expect(atom.get()).toBe(42);

		atom.set(100);
		await flushMicrotasks();
		expect(atom.get()).toBe(100);

		atom.set((x) => x * 2);
		await flushMicrotasks();
		expect(atom.get()).toBe(200);
	});

	it('derived atom', async () => {
		const atom1 = $(5);
		const atom2 = $(5);
		const derivedAtom = $((get) => get(atom1) + get(atom2));

		atom1.set(10);
		expect(derivedAtom.get()).toBe(10);
		await flushMicrotasks();
		expect(derivedAtom.get()).toBe(15);

		atom2.set(10);
		expect(derivedAtom.get()).toBe(15);
		await flushMicrotasks();
		expect(derivedAtom.get()).toBe(20);
	});

	it('async atom', async () => {
		const atom1 = $(async () => 10);
		const atom2 = $(async () => 20);
		const atom3 = $(0);
		const derivedAtom = $((get) => {
			return get(atom1) + get(atom2) + get(atom3);
		});
		derivedAtom.subscribe(nop);

		expect(!!atom1.state.promise).toBe(true);
		expect(!!atom2.state.promise).toBe(true);
		expect(!!derivedAtom.state.promise).toBe(true);

		await flushMicrotasks();
		expect(derivedAtom.state.value).toBe(30);

		atom3.set(inc);
		// expect(!!derivedAtom.state.promise).toBe(true);
		await flushMicrotasks();
		expect(derivedAtom.state.value).toBe(31);
	});

	it('repeated addition', async () => {
		const atom = $(0);
		const atom2 = $(2);
		const derivedAtom = $((get) => get(atom) * get(atom2));

		for (let i = 0; i < 100; i++) {
			atom.set(inc);
		}
		await flushMicrotasks();
		expect(derivedAtom.get()).toBe(200);

		atom2.set(3);
		await flushMicrotasks();
		expect(derivedAtom.get()).toBe(300);
	});

	it('deep addition', async () => {
		const atom = $(0);
		const atom2 = $(1);
		let derivedAtom = $((get) => get(atom) + get(atom2));
		for (let i = 1; i < 100; i++) {
			const prevAtom = derivedAtom;
			derivedAtom = $((get) => get(prevAtom) + get(atom2));
		}
		expect(derivedAtom.get()).toBe(100);

		atom.set(1);
		await flushMicrotasks();
		expect(derivedAtom.get()).toBe(101);

		atom2.set(2);
		await flushMicrotasks();
		expect(derivedAtom.get()).toBe(201);
	});

	it('primitive atom subscribe', async () => {
		const atom = $(42);

		const mockFn = vi.fn();
		const unsub = atom.subscribe(mockFn);
		await flushMicrotasks();
		expect(mockFn).toHaveBeenCalledWith(42, expect.anything());
		mockFn.mockClear();

		atom.set(100);
		await flushMicrotasks();
		expect(mockFn).toHaveBeenCalledWith(100, expect.anything());
		mockFn.mockClear();

		unsub();
		atom.set(0);
		await flushMicrotasks();
		expect(mockFn).not.toHaveBeenCalled();
	});

	it('derived atom subscribe', async () => {
		const atom = $(42);
		const derivedAtom = $((get) => get(atom) * 2);

		const mockFn = vi.fn();
		const unsub = derivedAtom.subscribe(mockFn);
		await flushMicrotasks();
		expect(mockFn).toHaveBeenCalledWith(84, expect.anything());
		mockFn.mockClear();

		atom.set(100);
		await flushMicrotasks();
		expect(mockFn).toHaveBeenCalledWith(200, expect.anything());
		mockFn.mockClear();

		unsub();
		atom.set(0);
		await flushMicrotasks();
		expect(mockFn).not.toHaveBeenCalled();
	});

	it('atom watch', async () => {
		const atom = $(42);
		const derivedAtom = $((get) => Promise.resolve(get(atom) * 2));

		const mockFn = vi.fn();
		const unwatch = derivedAtom.watch(mockFn);
		await flushMicrotasks();
		expect(mockFn).toBeCalledTimes(2);
		mockFn.mockClear();

		unwatch();
		atom.set(0);
		await flushMicrotasks();
		expect(mockFn).toBeCalledTimes(0);
	});

	it('state property reflects current value', async () => {
		const atom = $(42);
		expect(atom.state).toEqual({
			promise: undefined,
			error: undefined,
			value: 42,
		});
	});
});

describe('Atom Library - Advanced Tests', () => {
	it('handles complex dependency chains', async () => {
		const baseAtom = $(1);
		const derived1 = $((get) => get(baseAtom) * 2);
		const derived2 = $((get) => get(derived1) + 1);
		let resolve = nop;
		const asyncDerived = $(async (get) => {
			const value = get(derived2);
			await new Promise<void>((r) => (resolve = r));
			return value * 2;
		});
		asyncDerived.subscribe(nop);
		await flushMicrotasks();
		expect(!!asyncDerived.state.promise).toBe(true);

		resolve();
		await flushMicrotasks();
		expect(asyncDerived.state.value).toBe(6);

		baseAtom.set(2);
		await flushMicrotasks();
		expect(!!asyncDerived.state.promise).toBe(true);

		resolve();
		await flushMicrotasks();
		expect(asyncDerived.state.value).toBe(10);
	});

	it('first promise first resolved 1', async () => {
		const countAtom = $(0);
		const resolve = nops();
		const asyncAtom = $(async (get) => {
			const count = get(countAtom);
			await new Promise<void>((r) => resolve.push(r));
			return count;
		});
		const mock = vi.fn();
		asyncAtom.subscribe(mock);

		countAtom.set((c) => c + 1);
		countAtom.set((c) => c + 1);
		await flushMicrotasks();
		expect(resolve.length).toBe(1);

		resolve.shift()?.();
		await flushMicrotasks();
		expect(asyncAtom.state.value).toBe(2);
	});

	it('first promise first resolved 2', async () => {
		const countAtom = $(0);
		const resolve = nops();
		const asyncAtom = $(async (get) => {
			const count = get(countAtom);
			await new Promise<void>((r) => resolve.push(r));
			return count;
		});
		const mock = vi.fn();
		asyncAtom.subscribe(mock);

		countAtom.set((c) => c + 1);
		await flushMicrotasks();
		countAtom.set((c) => c + 1);
		await flushMicrotasks();
		expect(resolve.length).toBe(2);

		resolve.shift()?.();
		await flushMicrotasks();
		expect(!!asyncAtom.state.promise).toBe(true);

		resolve.shift()?.();
		await flushMicrotasks();
		expect(asyncAtom.state.value).toBe(2);
	});

	it('last promise first resolved 1', async () => {
		const countAtom = $(0);
		const resolve = nops();
		const asyncAtom = $(async (get) => {
			const count = get(countAtom);
			await new Promise<void>((r) => resolve.push(r));
			return count;
		});
		const mock = vi.fn();
		asyncAtom.subscribe(mock);

		countAtom.set((c) => c + 1);
		countAtom.set((c) => c + 1);
		await flushMicrotasks();
		expect(resolve.length).toBe(1);

		resolve.pop()?.();
		await flushMicrotasks();
		expect(asyncAtom.state.value).toBe(2);
	});

	it('last promise first resolved 2', async () => {
		const countAtom = $(0);
		const resolve = nops();
		const asyncAtom = $(async (get) => {
			const count = get(countAtom);
			await new Promise<void>((r) => resolve.push(r));
			return count;
		});
		const mock = vi.fn();
		asyncAtom.subscribe(mock);

		countAtom.set((c) => c + 1);
		await flushMicrotasks();
		countAtom.set((c) => c + 1);
		await flushMicrotasks();
		expect(resolve.length).toBe(2);

		resolve.pop()?.();
		await flushMicrotasks();
		expect(asyncAtom.state.value).toBe(2);

		resolve.pop()?.();
		await flushMicrotasks();
		expect(asyncAtom.state.value).toBe(2);
	});

	it('deep addition', async () => {
		const atom = $(0);
		let derivedAtom = $((get) => get(atom) + 1);
		for (let i = 1; i < 100; i++) {
			const prevAtom = derivedAtom;
			derivedAtom = $((get) => get(prevAtom) + 1);
		}
		expect(derivedAtom.get()).toBe(100);
	});

	it('custom equality function prevents unnecessary updates', async () => {
		const mockFn = vi.fn();
		const atom = $(
			{ value: 42 },
			{
				equals: (a, b) => a.value === b.value,
			},
		);

		atom.subscribe(mockFn);
		await flushMicrotasks();
		expect(mockFn).toHaveBeenCalled();
		mockFn.mockClear();

		// This should not trigger an update due to custom equality
		atom.set({ value: 42 });
		await flushMicrotasks();
		expect(mockFn).not.toHaveBeenCalled();

		// This should trigger an update
		atom.set({ value: 100 });
		await flushMicrotasks();
		expect(mockFn).toHaveBeenCalled();
	});

	it('async derived atoms handle promises correctly', async () => {
		const atom = $(1);
		const asyncAtom = $((get) => {
			const id = get(atom);
			return Promise.resolve(`user-${id}`);
		});
		const mockFn1 = vi.fn();
		asyncAtom.subscribe(mockFn1);

		// Initial fetch should be pending
		expect(!!asyncAtom.state.promise).toBe(true);

		// Wait for resolution
		await flushMicrotasks();
		await flushMicrotasks();

		expect(!!asyncAtom.state.promise).toBe(false);
		expect(asyncAtom.get()).toBe('user-1');

		// Update dependency
		atom.set(2);
		await flushMicrotasks();
		await flushMicrotasks();

		expect(asyncAtom.get()).toBe('user-2');
	});

	it('atom mount/unmount', async () => {
		const atom1 = $(10);
		const atom2 = $(20);

		const metrics1 = { mounted: 0, unmounted: 0 };
		const derivedAtom1 = $(async (get, { signal }) => {
			metrics1.mounted++;
			signal.then(() => {
				metrics1.unmounted++;
			});
			return get(atom1);
		});

		const metrics2 = { mounted: 0, unmounted: 0 };
		const derivedAtom2 = $(async (get, { signal }) => {
			metrics2.mounted++;
			signal.then(() => {
				metrics2.unmounted++;
			});
			return get(atom2);
		});

		let resolve = nop;
		const metrics3 = { mounted: 0, unmounted: 0 };
		const derivedAtom3 = $(async (get, { signal }) => {
			metrics3.mounted++;
			signal.then(() => {
				metrics3.unmounted++;
			});
			const v1 = get(derivedAtom1);
			await new Promise<void>((r) => (resolve = r));
			const v2 = get(derivedAtom2);
			return v1 + v2;
		});

		const unsub = derivedAtom3.subscribe(nop);
		await flushMicrotasks();
		expect(metrics1).toEqual({ mounted: 1, unmounted: 0 });
		expect(metrics2).toEqual({ mounted: 0, unmounted: 0 });
		expect(metrics3).toEqual({ mounted: 2, unmounted: 1 });
		expect(derivedAtom1.state.value).toEqual(10);
		expect(derivedAtom2.state.value).toEqual(undefined);
		expect(!!derivedAtom3.state.promise).toEqual(true);

		resolve();
		await flushMicrotasks();
		expect(metrics1).toEqual({ mounted: 1, unmounted: 0 });
		expect(metrics2).toEqual({ mounted: 1, unmounted: 0 });
		expect(metrics3).toEqual({ mounted: 3, unmounted: 2 });
		expect(derivedAtom1.state.value).toEqual(10);
		expect(derivedAtom2.state.value).toEqual(20);
		expect(!!derivedAtom3.state.promise).toEqual(true);

		resolve();
		await flushMicrotasks();
		expect(metrics1).toEqual({ mounted: 1, unmounted: 0 });
		expect(metrics2).toEqual({ mounted: 1, unmounted: 0 });
		expect(metrics3).toEqual({ mounted: 3, unmounted: 2 });
		expect(derivedAtom1.state.value).toEqual(10);
		expect(derivedAtom2.state.value).toEqual(20);
		expect(derivedAtom3.state.value).toEqual(30);

		atom2.set(30);
		await flushMicrotasks();
		resolve();
		await wait();
		expect(metrics1).toEqual({ mounted: 1, unmounted: 0 });
		expect(metrics2).toEqual({ mounted: 2, unmounted: 1 });
		expect(metrics3).toEqual({ mounted: 4, unmounted: 3 });
		expect(derivedAtom1.state.value).toEqual(10);
		expect(derivedAtom2.state.value).toEqual(30);
		expect(derivedAtom3.state.value).toEqual(40);

		unsub();
		resolve = nop;
		await new Promise((r) => setTimeout(r, 10));
		expect(metrics1).toEqual({ mounted: 1, unmounted: 1 });
		expect(metrics2).toEqual({ mounted: 2, unmounted: 2 });
		expect(metrics3).toEqual({ mounted: 4, unmounted: 4 });
		expect(!!derivedAtom3.state.promise).toEqual(true);

		atom1.set(20);
		await flushMicrotasks();
		expect(resolve).toBe(nop);
		await flushMicrotasks();
		expect(metrics1).toEqual({ mounted: 1, unmounted: 1 });
		expect(metrics2).toEqual({ mounted: 2, unmounted: 2 });
		expect(metrics3).toEqual({ mounted: 4, unmounted: 4 });
		expect(derivedAtom3.state.value).toEqual(undefined);
	});

	it('gc test', async () => {
		const atom1 = $(10);

		const metrics1 = { mounted: 0, unmounted: 0 };
		const derivedAtom1 = $((get, { signal }) => {
			metrics1.mounted++;
			signal.then(() => {
				metrics1.unmounted++;
			});
			return get(atom1);
		});

		const unsub = derivedAtom1.subscribe(nop);
		await flushMicrotasks();
		expect(metrics1).toEqual({ mounted: 1, unmounted: 0 });
		expect(derivedAtom1.state.value).toEqual(10);

		unsub();
		await flushMicrotasks();
		expect(metrics1).toEqual({ mounted: 1, unmounted: 0 });
		expect(derivedAtom1.state.value).toEqual(10);

		const unsub2 = derivedAtom1.subscribe(nop);
		await flushMicrotasks();
		expect(metrics1).toEqual({ mounted: 1, unmounted: 0 });
		expect(derivedAtom1.state.value).toEqual(10);

		atom1.set(20);
		await flushMicrotasks();
		expect(metrics1).toEqual({ mounted: 2, unmounted: 1 });
		expect(derivedAtom1.state.value).toEqual(20);

		unsub2();
		await new Promise((r) => setTimeout(r, 10));
		expect(metrics1).toEqual({ mounted: 2, unmounted: 2 });
		expect(derivedAtom1.state.value).toEqual(undefined);

		atom1.set(30);
		await flushMicrotasks();
		expect(metrics1).toEqual({ mounted: 2, unmounted: 2 });
		expect(derivedAtom1.state.value).toEqual(undefined);
	});

	it('should not provide stale values to conditional dependents', async () => {
		const dataAtom = $([100]);
		const hasFilterAtom = $(false);
		const filteredAtom = $((get) => {
			const data = get(dataAtom);
			return get(hasFilterAtom) ? [] : data;
		});
		const stageAtom = $((get) =>
			!get(hasFilterAtom) ? 0 : get(filteredAtom).length === 0 ? 1 : 2,
		);

		filteredAtom.subscribe(nop);
		stageAtom.subscribe(nop);

		expect(stageAtom.get(), 'should start without filter').toBe(0);

		hasFilterAtom.set(true);
		await flushMicrotasks();
		expect(stageAtom.get(), 'should update').toBe(1);
	});

	it('async derived atoms handle errors correctly', async () => {
		const error = new Error('Test error');
		const errorAtom = $(() => Promise.reject(error));
		const mockFn1 = vi.fn();
		errorAtom.subscribe(mockFn1);

		await flushMicrotasks();
		await flushMicrotasks(); // Additional wait for promise resolution

		expect(errorAtom.state.error).toBe(error);
		expect(() => errorAtom.get()).toThrowError(error);
	});

	it('multiple subscribers receive updates', async () => {
		const atom = $(42);
		const mockFn1 = vi.fn();
		const mockFn2 = vi.fn();

		atom.subscribe(mockFn1);
		atom.subscribe(mockFn2);
		await flushMicrotasks();
		mockFn1.mockClear();
		mockFn2.mockClear();

		atom.set(100);
		await flushMicrotasks();

		expect(mockFn1).toHaveBeenCalledWith(100, expect.anything());
		expect(mockFn2).toHaveBeenCalledWith(100, expect.anything());
	});

	it('atoms with unused dependencies are garbage collected', async () => {
		const a = $(10);
		const b = $((get) => get(a) + 5);

		// Create a derived atom and subscribe to it
		const c = $((get) => get(b) * 2);
		const unsub = c.subscribe(nop);
		await flushMicrotasks();

		// Get initial state
		expect(c.get()).toBe(30);

		// Unsubscribe and ensure atom is "disabled"
		unsub();
		await flushMicrotasks();

		// Change dependency
		a.set(20);
		await flushMicrotasks();

		// Re-access should recompute with latest values
		expect(c.get()).toBe(50);
	});

	it('batched updates are processed efficiently', async () => {
		const atom = $(0);
		const derivedAtom = $((get) => get(atom) * 2);
		const mockFn = vi.fn();

		derivedAtom.subscribe(mockFn);
		await flushMicrotasks();
		mockFn.mockClear();

		// Multiple updates in same microtask should batch
		atom.set(1);
		atom.set(2);
		atom.set(3);

		await flushMicrotasks();

		// Should only be called once with final value
		expect(mockFn).toHaveBeenCalledTimes(1);
		expect(mockFn).toHaveBeenCalledWith(6, expect.anything());
	});

	it('can propagate updates with async $ chains', async () => {
		const countAtom = $(1);
		let resolve = nop;
		const asyncAtom = $(async (get) => {
			const count = get(countAtom);
			await new Promise<void>((r) => (resolve = r));
			return count;
		});
		const async2Atom = $((get) => get(asyncAtom) % 3);
		const mockFn = vi.fn((get: (atom: DerivedAtom<number>) => any) => get(async2Atom));
		const async3Atom = $(mockFn);

		async3Atom.subscribe(nop);
		await flushMicrotasks();
		resolve();
		await flushMicrotasks();
		expect(async3Atom.state.value).toBe(1);
		expect(mockFn).toHaveBeenCalledTimes(2);

		countAtom.set((c) => c + 1);
		await flushMicrotasks();
		resolve();
		await flushMicrotasks();
		expect(async3Atom.state.value).toBe(2);
		expect(mockFn).toHaveBeenCalledTimes(3);

		countAtom.set((c) => c + 3);
		await flushMicrotasks();
		resolve();
		await flushMicrotasks();
		expect(async3Atom.state.value).toBe(2);
		expect(mockFn).toHaveBeenCalledTimes(3);
	});
});

describe('Bansa Documentation Examples as Tests', () => {
	// fetch 모킹
	const mockFetch = vi.fn();
	beforeEach(() => {
		vi.stubGlobal('fetch', mockFetch);
		mockFetch.mockClear();
	});

	// --- "상태를 얼마나 쪼개는 게 좋나요?" 예제 테스트 ---
	describe('Atom Granularity Example', () => {
		// 테스트에 사용할 가상 DOM 요소
		const userElm = { innerHTML: '' };
		const postElm = { innerHTML: '' };
		const commentElm = { innerHTML: '' };

		beforeEach(() => {
			userElm.innerHTML = '';
			postElm.innerHTML = '';
			commentElm.innerHTML = '';
			mockFetch.mockImplementation(async (url: string) => {
				if (url.includes('/users/')) {
					return {
						ok: true,
						json: async () => ({
							name: 'John Doe',
							author: 'John Doe',
						}),
					};
				}
				if (url.includes('/posts/')) {
					return {
						ok: true,
						json: async () => ({
							html: '<p>Post content</p>',
							author: 'Jane Smith',
						}),
					};
				}
				return { ok: false, status: 404 };
			});
		});

		it('Bad Practice: Combined state causes unnecessary re-fetches', async () => {
			const $userId = $(123);
			const $postId = $(456);

			// 모든 로직이 하나의 파생 상태에 결합된 경우
			const $pageData = $(async (get, { signal }) => {
				const user = await fetch(`/users/${get($userId)}`, {
					signal,
				}).then((res) => res.json());
				const post = await fetch(`/posts/${get($postId)}`, {
					signal,
				}).then((res) => res.json());

				userElm.innerHTML = user.name;
				postElm.innerHTML = post.html;
				commentElm.innerHTML = `Hello ${user.name}! Comment to ${post.author}.`;
				return { user, post };
			});

			const unsub = $pageData.subscribe(() => {});
			await flushMicrotasks(); // 초기 실행 대기

			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(mockFetch).toHaveBeenCalledWith(
				'/users/123',
				expect.anything(),
			);
			expect(mockFetch).toHaveBeenCalledWith(
				'/posts/456',
				expect.anything(),
			);
			expect(userElm.innerHTML).toBe('John Doe');
			expect(postElm.innerHTML).toBe('<p>Post content</p>');

			mockFetch.mockClear();

			// postId만 변경되어도 user와 post를 모두 다시 fetch함
			$postId.set(789);
			await flushMicrotasks(); // 업데이트 대기

			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(mockFetch).toHaveBeenCalledWith(
				'/users/123',
				expect.anything(),
			); // 불필요한 호출
			expect(mockFetch).toHaveBeenCalledWith(
				'/posts/789',
				expect.anything(),
			);

			unsub();
		});

		it('Good Practice: Split states prevent unnecessary re-fetches', async () => {
			const $userId = $(123);
			const $user = $((get, { signal }) =>
				fetch(`/users/${get($userId)}`, { signal }).then((res) =>
					res.json(),
				),
			);

			const $postId = $(456);
			const $post = $((get, { signal }) =>
				fetch(`/posts/${get($postId)}`, { signal }).then((res) =>
					res.json(),
				),
			);

			const $pageData = $((get) => ({
				userName: get($user).name,
				postAuthor: get($post).author,
			}));

			const userSub = $user.subscribe((user) => {
				userElm.innerHTML = user.name;
			});
			const postSub = $post.subscribe((post) => {
				postElm.innerHTML = post.html;
			});
			const pageDataSub = $pageData.subscribe(
				({ userName, postAuthor }) => {
					commentElm.innerHTML = `Hello ${userName}! Comment to ${postAuthor}.`;
				},
			);

			await flushMicrotasks(); // 초기 실행 대기

			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(mockFetch).toHaveBeenCalledWith(
				'/users/123',
				expect.anything(),
			);
			expect(mockFetch).toHaveBeenCalledWith(
				'/posts/456',
				expect.anything(),
			);
			expect(userElm.innerHTML).toBe('John Doe');
			expect(postElm.innerHTML).toBe('<p>Post content</p>');
			expect(commentElm.innerHTML).toBe(
				'Hello John Doe! Comment to Jane Smith.',
			);

			mockFetch.mockClear();

			// postId만 변경. user는 다시 fetch되지 않음
			$postId.set(789);
			await flushMicrotasks(); // 업데이트 대기

			expect(mockFetch).toHaveBeenCalledTimes(1); // post만 호출됨
			expect(mockFetch).toHaveBeenCalledWith(
				'/posts/789',
				expect.anything(),
			);
			expect(mockFetch).not.toHaveBeenCalledWith(
				'/users/123',
				expect.anything(),
			);
			expect(commentElm.innerHTML).toBe(
				'Hello John Doe! Comment to Jane Smith.',
			); // post.author가 업데이트됨

			userSub();
			postSub();
			pageDataSub();
		});
	});

	// --- "onMount/onCleanup은 어떻게 하나요?" 예제 테스트 ---
	describe('onMount / onCleanup Patterns', () => {
		it('Pattern 1: Atom returning an atom for shared resources', async () => {
			const onMount = vi.fn();
			const onCleanup = vi.fn();
			const mockWs = {
				close: vi.fn(),
				send: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			};

			// 공유 커넥션 상태
			const $wsConnection = $((_, { signal }) => {
				onMount();
				signal.then(onCleanup);
				signal.then(() => mockWs.close());

				return {
					send: (message: string) => mockWs.send(message),
					addEventListener: (
						listener: (data: any) => void,
						listenerSignal: ThenableSignal,
					) => {
						mockWs.addEventListener('message', listener);
						listenerSignal.then(() =>
							mockWs.removeEventListener('message', listener),
						);
					},
				};
			});

			// 커넥션을 사용하는 상태 팩토리
			const lastMessage = (name: string) =>
				$((get, { signal }) => {
					const { send, addEventListener } = get($wsConnection);
					const $lastMessage = $(null);
					addEventListener(({ type, value }) => {
						if (type === name) $lastMessage.set(value);
					}, signal);

					send(`+${name}`);
					signal.then(() => send(`-${name}`));
					return $lastMessage;
				});

			const $alice = lastMessage('alice');
			const $bob = lastMessage('bob');

			// 첫 구독: onMount 호출
			const unsubAlice = $alice.subscribe(() => {});
			await flushMicrotasks();
			expect(onMount).toHaveBeenCalledTimes(1);
			expect(onCleanup).not.toHaveBeenCalled();
			expect(mockWs.send).toHaveBeenCalledWith('+alice');

			// 두 번째 구독: onMount는 다시 호출되지 않음
			const unsubBob = $bob.subscribe(() => {});
			await flushMicrotasks();
			expect(onMount).toHaveBeenCalledTimes(1);
			expect(mockWs.send).toHaveBeenCalledWith('+bob');

			// 첫 구독 해제: onCleanup은 아직 호출되지 않음
			unsubAlice();
			await new Promise((r) => setTimeout(r, 10)); // disableAtom 대기
			expect(onCleanup).not.toHaveBeenCalled();
			expect(mockWs.send).toHaveBeenCalledWith('-alice');

			// 마지막 구독 해제: onCleanup 호출
			unsubBob();
			await new Promise((r) => setTimeout(r, 10)); // disableAtom 대기
			expect(onCleanup).toHaveBeenCalledTimes(1);
			expect(mockWs.close).toHaveBeenCalledTimes(1);
			expect(mockWs.send).toHaveBeenCalledWith('-bob');
		});

		it('Pattern 2: Read/Write separation for lifecycles', async () => {
			const onMount = vi.fn();
			const onCleanup = vi.fn();

			const $writer = $(0);
			const $shared = $((_, { signal }) => {
				onMount();
				signal.then(onCleanup);
			});
			const $reader = $((get) => {
				get($shared); // $shared의 생명주기에 의존
				return get($writer);
			});

			// 구독 전: 아무것도 호출되지 않음
			expect(onMount).not.toHaveBeenCalled();

			// 구독 시: onMount 호출
			const unsub = $reader.subscribe(() => {});
			await flushMicrotasks();
			expect(onMount).toHaveBeenCalledTimes(1);
			expect($reader.get()).toBe(0);

			// 쓰기 상태 업데이트: onMount는 다시 호출되지 않음
			$writer.set(10);
			await flushMicrotasks();
			expect(onMount).toHaveBeenCalledTimes(1);
			expect($reader.get()).toBe(10);

			// 구독 해제 시: onCleanup 호출
			unsub();
			await new Promise((r) => setTimeout(r, 10)); // disableAtom 대기
			expect(onCleanup).toHaveBeenCalledTimes(1);
		});
	});

	// --- "디바운스-스로틀링" 예제 테스트 ---
	describe('Debounce-Throttling Example', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		const delayedState = <Value>(
			initial: Value,
			minDelay: number,
			maxDelay: number,
		) => {
			const $value = $(initial);
			const $delayedValue = $(initial);

			const $eventStartTime = $(0);
			const $eventLastTime = $(0);
			const $delayedTime = $((get) =>
				Math.min(
					get($eventStartTime) + maxDelay,
					get($eventLastTime) + minDelay,
				),
			);
			const $delayedInfo = $((get) => ({
				value: get($value),
				time: get($delayedTime),
			}));
			$delayedInfo.subscribe(({ value, time }, { signal }) => {
				const timeout = Math.max(0, time - Date.now());
				const timer = setTimeout(
					() => $delayedValue.set(value),
					timeout,
				);
				signal.then(() => clearTimeout(timer));
			});

			const update = (value: Value, eager = false) => {
				const now = eager ? -Infinity : Date.now();
				if ($delayedValue.state.value === $value.state.value) {
					$eventStartTime.set(now);
				}
				$eventLastTime.set(now);
				$value.set(value);
			};

			return [$delayedValue, update] as const;
		};

		it('should update after minDelay', async () => {
			const [$inputValue, updateInput] = delayedState('', 200, 1000);
			const subscriber = vi.fn();
			$inputValue.subscribe(subscriber);
			await flushMicrotasks();
			subscriber.mockClear();

			updateInput('test');
			await flushMicrotasks();
			expect(subscriber).not.toHaveBeenCalled();

			vi.advanceTimersByTime(199);
			await flushMicrotasks();
			expect(subscriber).not.toHaveBeenCalled();

			vi.advanceTimersByTime(2); // 총 201ms 경과
			await flushMicrotasks();
			expect(subscriber).toHaveBeenCalledWith('test', expect.anything());
		});

		it('should update after maxDelay even with continuous updates', async () => {
			const [$inputValue, updateInput] = delayedState('', 200, 1000);
			const subscriber = vi.fn();
			$inputValue.subscribe(subscriber);
			await flushMicrotasks();
			subscriber.mockClear();

			updateInput('a'); // 0ms
			await flushMicrotasks();

			vi.advanceTimersByTime(500); // 500ms
			updateInput('ab');
			await flushMicrotasks();

			vi.advanceTimersByTime(500); // 1000ms
			await flushMicrotasks();
			expect(subscriber).toHaveBeenCalledWith('ab', expect.anything());
			subscriber.mockClear();

			updateInput('abc');
			await flushMicrotasks();
			vi.advanceTimersByTime(1001); // maxDelay 경과
			await flushMicrotasks();
			expect(subscriber).toHaveBeenCalledWith('abc', expect.anything());
		});
	});

	// --- 스코프 테스트 ---
	describe('Scope', () => {
		it('scope with initial values', async () => {
			const $x = $(0);
			const $y = $(1);
			const $x2 = $(100);
			const scope = createScope(null, [
				[$x, $x2],
				[$y, 101],
			]);

			const $y2 = scope($y);
			expect(scope($x)).toBe($x2);
			expect($y2).not.toBe($y);
			expect($y2).toBe(scope($y));

			expect($x.get()).toBe(0);
			expect($y.get()).toBe(1);
			expect($x2.get()).toBe(100);
			expect($y2.get()).toBe(101);
		});

		it('scope with updates (1)', async () => {
			const $x = $(0);
			const $y = $((get) => get($x) + 1);
			const scope = createScope();
			const $x2 = scope($x);
			const $y2 = scope($y);

			expect($x.get()).toBe(0);
			expect($y.get()).toBe(1);
			expect($x2.get()).toBe(0);
			expect($y2.get()).toBe(1);

			$x.set(10);
			await flushMicrotasks();

			expect($x.get()).toBe(10);
			expect($y.get()).toBe(11);
			expect($x2.get()).toBe(0);
			expect($y2.get()).toBe(1);

			$x2.set(100);
			await flushMicrotasks();

			expect($x.get()).toBe(10);
			expect($y.get()).toBe(11);
			expect($x2.get()).toBe(100);
			expect($y2.get()).toBe(101);
		});

		it('scope with updates (2)', async () => {
			const $x = $(0);
			const $y = $((get) => get($x) + 1);
			const scope = createScope(null, [
				[$x, 100],
			]);
			const $x2 = scope($x);
			const $y2 = scope($y);

			expect($x.get()).toBe(0);
			expect($y.get()).toBe(1);
			expect($x2.get()).toBe(100);
			expect($y2.get()).toBe(101);

			$x.set(10);
			await flushMicrotasks();

			expect($x.get()).toBe(10);
			expect($y.get()).toBe(11);
			expect($x2.get()).toBe(100);
			expect($y2.get()).toBe(101);

			$x2.set(1000);
			await flushMicrotasks();

			expect($x.get()).toBe(10);
			expect($y.get()).toBe(11);
			expect($x2.get()).toBe(1000);
			expect($y2.get()).toBe(1001);
		});

		it('scope with updates (3)', async () => {
			const $x = $(0);
			const $y = $((get) => get($x) + 1);
			const $x2 = $(100);
			const scope = createScope(null, [
				[$x, $x2],
			]);
			const $y2 = scope($y);

			expect($x.get()).toBe(0);
			expect($y.get()).toBe(1);
			expect($x2.get()).toBe(100);
			expect($y2.get()).toBe(101);

			$x.set(10);
			await flushMicrotasks();

			expect($x.get()).toBe(10);
			expect($y.get()).toBe(11);
			expect($x2.get()).toBe(100);
			expect($y2.get()).toBe(101);

			$x2.set(1000);
			await flushMicrotasks();

			expect($x.get()).toBe(10);
			expect($y.get()).toBe(11);
			expect($x2.get()).toBe(1000);
			expect($y2.get()).toBe(1001);
		});
	});

	// --- "스크롤 방향 감지" 예제 테스트 ---
	/*
	describe('Scroll Direction Detection Example', () => {
		let scrollHandler: () => void;

		beforeEach(() => {
			vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);
			vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
				if (event === 'scroll' || event === 'resize') {
					scrollHandler = handler as () => void;
				}
			});
			vi.spyOn(window, 'removeEventListener');
		});

		afterEach(() => {
			vi.mocked(window.addEventListener).mockRestore();
			vi.mocked(window.removeEventListener).mockRestore();
			vi.mocked(window.scrollY, 'get').mockRestore();
		});

		it('should detect scroll direction and update navHidden state', async () => {
			const $windowScroll = $((_, { signal }) => {
				let lastTime = Date.now();
				const $scrollY = $(window.scrollY);
				const $scrollOnTop = $((get) => get($scrollY) === 0);

				const $scrollMovingAvgY = $(0);
				const $scrollDirectionY = $((get) => Math.sign(get($scrollMovingAvgY)));

				const onScrollChange = () => {
					const now = Date.now();
					const alpha = 0.995 ** (now - lastTime);
					lastTime = now;
					const scrollY = window.scrollY;
					const deltaY = scrollY - $scrollY.state.value;
					const movingAvgY = alpha * $scrollMovingAvgY.state.value + (1 - alpha) * deltaY;

					$scrollY.set(scrollY);
					$scrollMovingAvgY.set(movingAvgY);
				};
				window.addEventListener('scroll', onScrollChange, { passive: true, signal });
				window.addEventListener('resize', onScrollChange, { passive: true, signal });

				return { $scrollOnTop, $scrollDirectionY };
			});

			const $navHidden = $((get) => {
				const { $scrollOnTop, $scrollDirectionY } = get($windowScroll);
				const scrollOnTop = get($scrollOnTop);
				const directionY = get($scrollDirectionY);
				return !scrollOnTop && directionY > 0;
			});

			const unsub = $navHidden.subscribe(() => {});
			await flushMicrotasks();

			// 초기 상태: 스크롤 최상단, nav 보임
			expect($navHidden.get()).toBe(false);

			// 아래로 스크롤: nav 숨김
			vi.spyOn(window, 'scrollY', 'get').mockReturnValue(200);
			scrollHandler();
			await flushMicrotasks();
			expect($navHidden.get()).toBe(true);

			// 위로 스크롤: nav 보임
			vi.spyOn(window, 'scrollY', 'get').mockReturnValue(100);
			scrollHandler();
			await flushMicrotasks();
			expect($navHidden.get()).toBe(false);

			// 최상단으로 스크롤: nav 보임
			vi.spyOn(window, 'scrollY', 'get').mockReturnValue(0);
			scrollHandler();
			await flushMicrotasks();
			expect($navHidden.get()).toBe(false);

			unsub();
		});
	});
	*/
});
