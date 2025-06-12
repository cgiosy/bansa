# Bansa

English | [한국어](https://github.com/cgiosy/bansa/blob/main/README.ko.md)

## Introduction

Bansa is a library that makes it easy to manage derived state, asynchronous values, dependencies and subscriptions, lifecycles, and side effects. Similar to [Jotai](https://jotai.org/), it follows a bottom-up approach using atoms.

It is a framework-independent library that can be used in a pure JavaScript environment without any other libraries or frameworks, as well as with React, Vue, Svelte, and others.

## Concepts

### State

You can create a state with the `$` function. There are two types of states.

#### Primitive State

The most basic unit of state. It can be updated to any value using the `.set` method.

It is created by passing a normal value (number/string/object, etc.) to the `$` function.

```javascript
import { $ } from 'bansa';

const $count = $(42);

const $user = $({ name: 'John Doe', age: 30 });
```

#### Derived State

A state whose value is computed by a function and has a lifecycle. It cannot be updated directly; it can only be re-executed when the value of a state it depends on changes. If the state is not active (i.e., there are no subscribers), the function will not run, and it is treated as having no dependencies.

It is created by passing a function to `$`. The arguments to this function are a `get` function, which can read the values of other states, and `{ signal }`, which represents the state's lifetime. The `signal` will be discussed in more detail in another section.

```javascript
const $countDouble = $((get) => get($count) * 2);

const $userMessage = $((get) => {
	if (get($count) < 50) return 'no hello.';
	return `Hello, ${get($user).name}!`;
});

const $signalExample = $((_, { signal }) => {
	signal.then(() => console.log("$signalExample died"));
	return fetch(`/users/${get($count)}`, { signal }).then((res) => res.json());
});
```

Here, `$countDouble` depends on `$count`, so if the value of `$count` changes, the value of `$countDouble` can be automatically recalculated.

`$userMessage` depends on `$count`, and if the value of `$count` is not less than `50`, it also depends on `$user`. This means if `$count` is less than `50`, `$userMessage` will not be recalculated even if the value of `$user` changes.

This explanation describes the behavior when the state is active. It will not execute in either case until it is subscribed to using the `.subscribe()` or `.watch()` methods, which will be discussed later.

##### Reading `state` (Preventing unwrap)

The second parameter of `get` is an optional `unwrap` option. The default value is `true`, so it always returns the unwrapped value. If set to `false`, it returns the `state` of type `AtomState<Value>`.

`state` is a read-only object representing the current status of the state. It is useful for handling situations where the value is not ready, such as with asynchronous states or expected errors (e.g., for showing a placeholder). `value` holds the last successfully resolved value. `promise` and `error` hold their respective values if the state is currently loading or has encountered an error. The exact type is as follows:

```typescript
type AtomState<Value> =
	| { promise: undefined; error: undefined; value: Value; } // Success
	| { promise: undefined; error: any; value?: Value; } // Error
	| { promise: PromiseLike<Value>; error: any; value?: Value; } // Loading
	| { promise: typeof inactive; error: undefined; value?: Value; } // Inactive
```

##### Keeping a state active

You can pass an options object as the second parameter to `$`. If `persist` is set to `true` in the options object, the state will not be deactivated once it becomes active. This can be used instead of adding a meaningless subscription just to keep the state active.

This is useful for values that rarely change but need to be ready for use at any time. A typical example is fetching or importing static assets.

### Reading State Directly

You can read the current value of a state using the `atom.get()` method or `atom.state` property.

```javascript
console.log($count.get()); // 42
console.log($countDouble.get()); // 84

console.log($countDouble.state); // { promise: undefined, error: undefined, value: 84 }
```

For derived states, `.get()` can throw. It throws the `Promise` during asynchronous loading and throws the error when in an error state. This is useful when you want to primarily handle the success case and push all exception handling into a `catch` block or similar.

If a state is inactive, the `.get()` method temporarily transitions it to an active state. Naturally, the state and all its dependencies will be re-executed. "Temporarily" means at least until the end of the current microtask. This means that calling `.get()` synchronously multiple times in a row will not cause everything to re-execute each time.


### Updating State

You can update the value of a primitive state using the `.set(updater)` method. If `updater` is a normal value, the state is updated to that value. If it's a function, the state is updated with `updater(nextValue)`, where `nextValue` is the state's 'pending value'.

```javascript
console.log($count.get()); // 42

$count.set(100);
console.log($count.get(), $countDouble.get()); // !!! 42 84 !!!
queueMicrotask(() => console.log($count.get(), $countDouble.get())); // 100 200

const increment = (x) => x + 1;
$count.set(increment);
console.log($count.get()); // 101
```

All updates are batched per microtask. This means multiple synchronous updates are processed at once. In particular, if a single state is updated multiple times, it is treated as if it were updated only once with the final value.

If the `updater` is a function, it can access the last received 'pending value' `nextValue`. Therefore, when `.set` is called multiple times synchronously as shown below, `$count` will be incremented by `3`, but the update still happens only once.

```javascript
$count.set(increment);
$count.set(increment);
$count.set(increment);
```

If you must update based on the current value, you can use `.get()` or `.state`, like `$count.set($count.state.value + 1)`.

### Subscribing to State

You can detect updates with the `.subscribe(listener)` or `.watch(listener)` methods. Each method returns an unsubscribe function.

Upon subscription, if the state was inactive, an update is scheduled. During the update, the state and all its dependencies are activated. Upon unsubscription, if there are no more subscribers to the state, its deactivation is scheduled, and its dependencies are also checked for deactivation.

`.subscribe` calls the given function when the state is successfully updated. If the state has already been successfully updated, the function is called once with the current value upon subscription. The listener is called with the state's value as the first argument and `{ signal }` as the second. The `signal` is linked to the state's lifetime.

`.watch` calls the given function whenever the state changes. It can be used when you need to handle error or asynchronous states as well.

```javascript
const $count = $(0);
const unsubscribe = $count.subscribe((value, { signal }) => {
	console.log('value', value);
	signal.then(() => console.log('value end', value));
});

// value 0

$count.set(1);
// value 1
// value end 0

unsubscribe();
// value end 1

$count.set(2);
// (no output)
```

`.subscribe()` returns a function that can be used to unsubscribe. It is important to call this function when a component unmounts to prevent memory leaks.

If you want to subscribe to multiple states simultaneously, you should declare another state.

```javascript
const $merged = $((get) => ({
	count: get($count),
	countDouble: get($countDouble),
}));

$merged.subscribe(({ count, countDouble }) => console.log(`${count} * 2 = ${countDouble}`));
```

### Asynchronous State

For a derived state where the function returns a `Promise`, you can use the automatically unwrapped value when you `get` or `subscribe` to it. If you want to handle loading or failure cases, you can use `watch` or `state`.

```javascript
const $user = $(async (get) => {
	const response = await fetch(`/users/${get($count)}`);
	if (!response.ok) throw new Error('Failed to fetch user');
	return response.json();
});
$user.watch(() => {
	console.log($user.state);
});

const $userName = $((get) => get($user).name);

const faultyAtom = $(() => Promise.reject(new Error('Something went wrong')));
faultyAtom.watch(() => {
	if (!faultyAtom.state.promise && faultyAtom.state.error) {
		console.error('An error occurred:', faultyAtom.state.error.message);
	}
});
```

### State Lifetime (`signal`)

The `options.signal` passed as an argument to a derived function can be used like an `AbortSignal` and a `Promise` (strictly speaking, a thenable). It is `abort`ed and `resolve`d when the state's lifetime changes, such as when the state is updated or deactivated.

Like an `AbortSignal`, it can be passed to existing web APIs like `fetch` or `addEventListener` for cancellation or unsubscription. Like a `Promise`, you can use `signal.then` to write your own cleanup functions.

```javascript
const $user = $(async (get, { signal }) => {
	const count = get($count);
	const json = await fetch(`/users/${count}`, { signal }).then((res) => res.json());
	signal.then(() => {
		console.log(count, json, "not used");
	});
	return json;
});
```

### Custom Update Condition (Equality Check)

By default, equality is checked with `Object.is`, so for objects or arrays, an update can occur if the reference is different even if the content is the same. To perform additional equality checks, you can provide an `equals` option when declaring the state. In this case, it first checks with `Object.is`, and if they are different, it checks again with the `equals` function. If either returns true, the value change is ignored.

```javascript
const $user = $(
  { id: 1, name: 'Alice' },
  { equals: (next, prev) => next.id === prev.id },
);

const $user2 = $(
  (get) => get($user),
  { equals: (next, prev) => next.name === prev.name },
);

userAtom.set({ id: 1, name: 'Bob' });

userAtom.set({ id: 2, name: 'Alice' });
```

In the example above, the first update is ignored because the `id` is the same. The second update has a different `id`, so `$user` is updated, but since the `name` is the same, `$user2` is not updated.

### Merging Multiple States

You can create a new state by merging multiple states with `$$`. It's actually the same as `$`, but while `$`'s `get` function throws immediately when it encounters a `Promise` or an error, `$$`'s `get` function returns a special object to track maximum dependencies with minimum re-executions.

The following code takes 5 seconds to merge states with `$`, whereas it takes only 1 second with `$$`.

```javascript
const timer = (time) => new Promise((resolve) => setTimeout(() => resolve(1), time));
const a = [1, 2, 3, 4, 5].map(() => $(() => timer(1000)));
const merged = $$((get) => a.map(get));
console.time();
merged.subscribe(() => console.timeEnd());
```

For reference, the value that `$$`'s `get` function returns instead of throwing when it encounters a `Promise` or an error is created through the following process:

```javascript
const o = () => o;
const toUndefined = () => undefined;
Object.setPrototypeOf(o, new Proxy(o, { get: (_, k) => k === Symbol.toPrimitive ? toUndefined : o }));
```

The `o` in this code returns the same value no matter how many properties are accessed or functions are called. For example, `o.a.b.c().d()().asdf()()()() === o` is `true`. Therefore, it allows most state-merging functions composed of selectors and simple methods like filter/map/reduce to execute without issues. However, it's not a silver bullet, so some caution is needed, and it should preferably be used only for state merging.

## In-Depth

### How much should I split the state?

Split your state as much as possible, as long as it doesn't significantly harm code readability. Also, wrap as much logic as you can in as many layers of state as possible.

In fact, the reason `subscribe` wasn't designed to take a `get` function like `$` is to encourage splitting states as much as possible, so that `subscribe` only deals with the 'final state'.

Implicit 'intermediate states' remain 'hidden,' causing you to lose many of the library's benefits and potentially face issues like unnecessary recalculations, inability to reuse intermediate values, complicated dependency tracking, code repetition, broken side-effect idempotency, and the inability to manage fine-grained lifecycles and subscriptions.

For example, the following shows a situation where not splitting the state enough leads to 'unnecessary recalculations and inability to reuse intermediate values'.

```javascript
const $userId = $(123);
const $postId = $(456);
const $pageData = $(async (get, { signal }) => {
	const user = await fetch(`/users/${get($userId)}`, { signal }).then((res) => res.json());
	const post = await fetch(`/posts/${get($postId)}`, { signal }).then((res) => res.json());
	userElm.innerHTML = user.name;
	postElm.innerHTML = post.html;
	commentElm.innerHTML = `Hello ${user.name}! Comment to ${post.author}.`;
});
```

This code looks simple and clean, but if only one of `userId` or `postId` is updated, both requests are sent again. The latencies of `user` and `post` are summed up (which can be solved with `Promise.all`, but this increases code complexity). Unrelated side effects coexist, mixing contexts. And even if other values in `user` or `post` don't change, the `innerHTML` is updated, causing the DOM to be completely replaced. There are several problems. It should be split as follows:

```javascript
const $userId = $(123);
const $user = $((get) => fetch(`/users/${get($userId)}`, { signal }).then((res) => res.json()));
$user.subscribe((user) => { userElm.innerHTML = user.name; });

const $postId = $(456);
const $post = $((get) => fetch(`/posts/${get($postId)}`, { signal }).then((res) => res.json()));
$post.subscribe((post) => { postElm.innerHTML = post.html; });

const $pageData = $$((get) => ({
	userName: get($user).name,
	postAuthor: get($post).author,
}));
$pageData.subscribe(({ userName, postAuthor }) => { commentElm.innerHTML = `Hello ${userName}! Comment to ${postAuthor}.`; });
```

The number of lines of code has increased slightly, but the previously mentioned problems have been resolved.

This might be too simple of an example to be fully convincing, but in real-world scenarios, it's easy to accidentally mix states in a moment of carelessness. Also, the desire to handle everything in one place can often be hard to resist.

It's important to always be mindful of this and to split, wrap, and layer your states.

### How to implement `onMount`/`onCleanup`?

Sometimes you need to call a function not every time a state's value changes, but when the state becomes active and inactive (i.e., when subscribers start appearing and when there are no longer any subscribers). In other words, you need functionality like `onMount`/`onCleanup` (or `onDestroy`, etc.).

This can be solved in two ways. One is to create and return a state from within another state:

```javascript
const $shared = $((_, { signal }) => {
	const $state = $(0);
	/* onMount */
	signal.then(() => /* onCleanup */);
	return $state;
});
const $a = $((get) => {
	const $state = get($shared);
	const value = get($state);
	return value;
});
```

If modifications to `$state` only occur within `onMount` and `onCleanup` (for example, when subscribing to external events), this is the cleanest pattern. The following is an example that applies this to manage a connection shared by multiple places:

```javascript
const $wsConnection = $(() => {
	const conn = new WebSocket("...");
	signal.then(() => conn.close());

	const listeners = new Set();
	conn.onmessage = (e) => {
		const data = JSON.parse(e.data);
		for (const listener of listeners) subscriber(data);
	};

	return {
		send: (message) => conn.send(JSON.stringify(message));
		addEventListener: (listener, signal) => {
			listeners.add(listener);
			signal.then(() => listener.delete(listener));
		},
	};
});

const lastMessage = (name) =>
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

const $alice = lastMessage("alice");
const $bob = lastMessage("bob");
```

If the state needs to be modifiable from the outside, you can create two states like this:

```javascript
const $writer = $(0);
const $shared = $((_, { signal }) => {
	// onMount
	signal.then(() => /* onCleanup */);
});
const $reader = $((get) => {
	get($shared);
	return get($writer);
});
```

Now, you can read from `$reader` and write to `$writer`. Since `$shared` does not depend on `$writer`, `$shared` will not be updated even if `$writer` is modified.

## Examples

#### Debounce-Throttling

```javascript
const delayedState = (initial, minDelay, maxDelay) => {
	const $value = $(initial);
	const $delayedValue = $(initial);

	const $eventStartTime = $(0);
	const $eventLastTime = $(0);
	const $delayedTime = $((get) => Math.min(get($eventStartTime) + maxDelay, get($eventLastTime) + minDelay));
	const $delayedInfo = $((get) => ({
		value: get($value),
		time: get($delayedTime),
	}));
	$delayedInfo.subscribe(({ value, time }, { signal }) => {
		const timeout = Math.max(0, time - Date.now());
		const timer = setTimeout(() => $delayedValue.set(value), timeout);
		signal.then(() => clearTimeout(timer));
	});

	const update = (value, eager = false) => {
		const now = eager ? -Infinity : Date.now();
		if ($value.get() === $delayedValue.get()) $eventStartTime.set(now);
		$eventLastTime.set(now);
		$value.set(value);
	};

	return [$delayedValue, update];
};
```

```javascript
const [$inputValue, updateInput] = delayedState("", 200, 1000);
inputElm.addEventListener("input", (e) => updateInput(e.currentTarget.value));
$inputValue.subscribe(console.log);
```

### Scroll Direction Detection

```javascript
const $windowScroll = $((_, { signal }) => {
	let lastTime = Date.now();
	const $scrollY = $(window.scrollY);
	const $scrollOnTop = $((get) => get($scrollY) === 0);

	const $scrollMovingAvgY = $(0);
	const $scrollDirectionY = $((get) => Math.sign(get($scrollMovingAvgY)));

	const onScrollChange = () => {
		const now = Date.now();
		lastTime = now;

		const alpha = 0.995 ** (now - lastTime);
		const scrollY = window.scrollY;
		const deltaY = scrollY - $scrollY.get();
		const movingAvgY = alpha * $scrollMovingAvgY.get() + (1 - alpha) * deltaY;

		$scrollY.set(scrollY);
		$scrollMovingAvgY.set(movingAvgY);
	};
	window.addEventListener('scroll', onScrollChange, {
		passive: true,
		signal,
	});
	window.addEventListener('resize', onScrollChange, {
		passive: true,
		signal,
	});

	return {
		$scrollY,
		$scrollOnTop,
		$scrollMovingAvgY,
		$scrollDirectionY,
	};
});

const $navHidden = $((get) => {
	const { $scrollOnTop, $scrollDirectionY } = get($windowScroll);
	const scrollOnTop = get($scrollOnTop);
	const directionY = get($scrollDirectionY);
	return !scrollOnTop && directionY > 0;
});
```