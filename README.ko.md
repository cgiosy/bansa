# Bansa

[English](https://github.com/cgiosy/bansa/blob/main/README.md) | 한국어

## 소개

Bansa는 파생 상태, 비동기 값, 의존성과 구독, 생명 주기, 사이드 이펙트를 쉽게 관리할 수 있는 라이브러리입니다. [Jotai](https://jotai.org/)와 유사하게, atom을 사용한 상향식 접근 방식을 따릅니다.

어떤 라이브러리나 프레임워크도 사용하지 않는 순수 JavaScript 환경은 물론이고, React, Vue, Svelte 등에서도 사용 가능한 프레임워크 독립적 라이브러리입니다.

## 개념

### 상태

`$` 함수로 상태를 만들 수 있습니다. 상태는 두 종류가 있습니다.

#### 원시 상태

가장 기본적인 상태 단위로, 값이 정적이며, `.set` 메서드를 통해 임의의 값으로 업데이트할 수 있습니다.

일반 값(숫자/문자열/객체 등)을 `$` 함수에 전달하여 생성합니다.

```javascript
import { $ } from 'bansa';

const $count = $(42);

const $user = $({ name: 'John Doe', age: 30 });
```

#### 파생 상태

값이 동적이며, 생명 주기를 가지는 상태입니다. 값을 직접 업데이트할 수 없으며, 의존 중인 상태의 값이 바뀔 때에만 재실행될 수 있습니다. 해당 상태를 구독 중인 곳이 존재하는, 활성화된 상태가 아닐 경우 함수는 실행되지 않으며, 의존성 또한 없는 것으로 취급됩니다.

`$`에 함수를 전달하여 생성합니다. 전달하는 함수의 인자로는 다른 상태의 값을 읽을 수 있는 `get` 함수와 상태의 수명을 나타내는 `{ signal }`이 주어집니다. `signal`에 대해선 다른 파트에서 더 자세히 다룹니다.

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

이 때 `$countDouble`은 `$count`에 의존하므로, `$count`의 값이 변경되면 `$countDouble`의 값이 자동으로 다시 계산될 수 있습니다.

`$userMessage`는 `$count`에 의존하며, `$count`의 값이 `50` 미만이 아니라면 추가로 `$user`에도 의존합니다. 즉, `$count`가 `50` 미만이라면 `$user`의 값이 바뀌더라도 다시 계산되지 않습니다.

이 설명은 상태가 활성화된 상황일 때를 설명한 것이며, 후술할 `.subscribe()` 또는 `.watch()` 메서드로 구독되기 전까지는 어느 쪽이든 실행되지 않습니다.

##### `state` 읽기 (unwrap 방지하기)

`get`의 두 번째 파라미터로 선택적인 `unwrap`을 할 수 있습니다. 기본값은 `true`이므로 항상 unwrap된 값을 반환하며, `false`로 할 경우 `AtomState<Value>` 타입의 `state`을 반환합니다.

`state`은 상태의 현재 상태를 나타내는 읽기 전용 객체입니다. 비동기 상태거나 오류가 예상되는, 값이 준비되지 않은 상황을 처리(placeholder를 보여주는 등)해야 하는 상황에서 유용합니다. `value`는 마지막으로 성공했을 때의 값을 가집니다. `promise`와 `error`는 현재 로딩 중이거나 에러가 발생한 경우 해당 값을 가집니다. 정확한 타입은 다음과 같습니다:

```typescript
type AtomState<Value> =
	| { promise: undefined; error: undefined; value: Value; } // 성공
	| { promise: undefined; error: any; value?: Value; } // 에러
	| { promise: PromiseLike<Value>; error: any; value?: Value; } // 로딩
	| { promise: typeof inactive; error: undefined; value?: Value; } // 비활성
```

##### 활성 상태로 유지하기

`$`의 두 번째 파라미터로 옵션을 전달할 수 있습니다. 옵션 객체에서 `persist`가 `true`로 설정되어 있다면, 해당 객체는 한 번 활성화되면 다시 비활성화되지 않습니다. 활성 상태를 유지하려고 무의미한 구독을 추가하는 대신 사용할 수 있습니다.

값이 거의 바뀌지 않고, 언제든 다시 쓸 수 있게 준비해둬야 하는 경우 유용합니다. 대표적으론 정적인 에셋을 `fetch` 또는 `import`하는 상황이 있습니다.

### 상태 직접 읽기

`atom.get()` 메서드나 `atom.state`을 통해 상태의 현재 값을 읽을 수 있습니다.

```javascript
console.log($count.get()); // 42
console.log($countDouble.get()); // 84

console.log($countDouble.state); // { promise: undefined, error: undefined, value: 84 }
```

파생 상태는 `.get()` 했을 때 throw 될 수 있습니다. 비동기 로딩 중일 땐 해당 `Promise`를 throw하며, 오류 상태일 때는 해당 오류를 throw합니다. 값이 성공적으로 계산된 상황 위주로 처리하고, 예외 상황은 전부 `catch` 블록 등으로 밀어넣고 싶은 상황에서 유용합니다.

`.get()` 메서드는 상태가 비활성화된 경우, 매우 잠시 동안 해당 상태를 살아 있는 상태로 전환합니다. 당연히 해당 상태와 모든 의존성이 새로 실행됩니다. 매우 잠시 동안은 적어도 현재 마이크로태스크가 끝나기까지를 의미합니다. 즉, 동기적으로 연속해서 `.get()`을 호출하더라도 매번 모든 것이 다시 실행되지는 않습니다.


### 상태 업데이트

`.set(updater)` 메서드를 통해 원시 상태의 값을 업데이트할 수 있으며, `updater`가 일반 값이라면 해당 값으로 업데이트하고, 함수라면 상태의 '예비 값' `nextValue`에 대해 `updater(nextValue)`로 업데이트합니다.

```javascript
console.log($count.get()); // 42

$count.set(100);
console.log($count.get(), $countDouble.get()); // !!! 42 84 !!!
queueMicrotask(() => console.log($count.get(), $countDouble.get())); // 100 200

const increment = (x) => x + 1;
$count.set(increment);
console.log($count.get()); // 101
```

모든 업데이트는 마이크로태스크를 단위로 배치 처리됩니다. 즉, 동기적으로 발생하는 여러 업데이트는 한 번에 처리되며, 특히 하나의 상태가 여러 번 업데이트됐을 경우 마지막 값 한 번만 업데이트한 것으로 취급됩니다.

`updater`가 함수라면, 마지막으로 들어온 '예비 값' `nextValue`에 접근할 수 있습니다. 따라서, 다음과 같이 동기적으로 여러 번의 `.set`을 호출했을 때 `$count`는 `3`만큼 증가하게 됩니다. 단, 업데이트는 여전히 한 번만 됩니다.

```javascript
$count.set(increment);
$count.set(increment);
$count.set(increment);
```

반드시 현재 값을 기준으로 업데이트해야 한다면, `$count.set($count.state.value + 1)` 와 같이 `.get()` 또는 `.state`을 사용할 수 있습니다.

### 상태 구독

`.subscribe(listener)` 또는 `.watch(listener)` 메서드로 업데이트를 감지할 수 있습니다. 각 메서드는 구독 중단 함수를 반환합니다.

구독 시 해당 상태가 비활성화된 상태였다면 업데이트가 예약되며, 업데이트 시 해당 상태와 의존성까지 모두 활성화됩니다. 구독 해제 시 해당 상태를 구독하는 곳이 더이상 없다면 비활성화가 예약되며, 의존성도 비활성화 대상인지 확인됩니다.

`.subscribe`는 상태가 성공적으로 업데이트되었을 때 주어진 함수를 호출합니다. 이미 업데이트가 성공적으로 된 상태일 경우 구독 시 해당 값으로 한 번 호출합니다. 호출 시 첫 번째 인자는 해당 상태의 값, 두 번째 인자는 `{ signal }`이 주어지며, `signal`은 상태의 수명과 연동됩니다.

`.watch`는 해당 상태가 변화할 때 주어진 함수를 호출합니다. 오류나 비동기 상태를 추가적으로 처리하려는 경우 쓸 수 있습니다.

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
// (출력 없음)
```

`.subscribe()`는 구독을 해제할 수 있는 함수를 반환합니다. 컴포넌트가 언마운트될 때 이 함수를 호출하여 메모리 누수를 방지하는 것이 중요합니다.

만약 여러 상태를 동시에 구독하고 싶다면, 상태를 하나 더 선언해야 합니다.

```javascript
const $merged = $((get) => ({
	count: get($count),
	countDouble: get($countDouble),
}));

$merged.subscribe(({ count, countDouble }) => console.log(`${count} * 2 = ${countDouble}`));
```

### 비동기 상태

함수에서 `Promise`가 반환된 파생 상태의 경우, 해당 상태를 `get`하거나 `subscribe`했을 때 자동으로 unwrap된 값을 쓸 수 있습니다. 로딩이나 실패했을 때를 다루고 싶다면 `watch`나 `state`을 사용할 수 있습니다.

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

### 상태의 수명 (`signal`)

파생 함수의 인자로 전달되는 `options.signal`은 `AbortSignal` 및 `Promise` (엄밀히는 thenable)처럼 사용 가능합니다. 상태가 업데이트됐거나, 상태가 비활성화되는 등 상태의 수명이 변했을 때 `abort` 및 `resolve`됩니다.

`AbortSignal`처럼 `fetch`나 `addEventListener`같은 기존 웹 API에 전달하여 취소나 구독 중단 등에 사용할 수 있으며, `Promise`처럼 `signal.then`을 통해 자체 cleanup 함수를 쓸 수도 있습니다.

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

### 커스텀 업데이트 조건(동등성 확인)

기본적으로 `Object.is`로 동등성을 체크하므로 객체나 배열의 경우 참조가 다르면 내용이 같더라도 업데이트가 발생할 수 있으며, 추가로 동등성을 확인하기 위해 상태 선언 시 `equals`를 옵션으로 줄 수 있습니다. 이 경우 `Object.is`로 같은지 확인하고, 다르다면 `equals` 함수로 다시 확인합니다. 둘 중 하나라도 참을 반환하는 경우 값 변경은 무시됩니다.

```javascript
const $user = $(
  { id: 1, name: 'Alice' },
  { equals: (next, prev) => next.id === prev.id },
);

const $user2 = $(
  (get) => get($user).name,
  { equals: (next, prev) => next.name === prev.name },
);

userAtom.set({ id: 1, name: 'Bob' });

userAtom.set({ id: 2, name: 'Alice' });
```

위 예제에서 첫 번째 업데이트는 `id`가 같으므로 무시됩니다. 두 번째 업데이트는 `id`가 다르므로 `$user`를 업데이트하지만, `name`이 같으므로 `$user2`는 업데이트되지 않습니다.

### 여러 상태 병합하기

`$$`로 여러 상태를 병합한 새로운 상태를 만들 수 있습니다. 사실 `$`와 똑같지만, `$`의 `get` 함수는 `Promise`나 에러를 만났을 때 즉시 throw하는 반면, `$$`의 `get` 함수는 특별한 객체를 반환하여 최소한의 재실행으로 최대한의 의존성을 추적합니다.

다음 코드는 `$`로 상태를 병합하면 5초가 걸리는 반면에, `$$`로 상태를 병합하면 단 1초만이 걸립니다.

```javascript
const timer = (time) => new Promise((resolve) => setTimeout(() => resolve(1), time));
const a = [1, 2, 3, 4, 5].map(() => $(() => timer(1000)));
const merged = $$((get) => a.map(get));
console.time();
merged.subscribe(() => console.timeEnd());
```

참고로 `$$`의 `get` 함수가 `Promise`나 에러를 만났을 때 throw 대신 반환하는 값은 다음 과정으로 만들어집니다:

```javascript
const o = () => o;
const toUndefined = () => undefined;
Object.setPrototypeOf(o, new Proxy(o, { get: (_, k) => k === Symbol.toPrimitive ? toUndefined : o }));
```

이 코드의 `o`는 아무리 프로퍼티 접근 및 호출을 해도 같은 값을 반환합니다. `o.a.b.c().d()().asdf()()()() === o`는 `true`입니다. 따라서, 셀렉터와 filter/map/reduce 등 간단한 메서드로 이뤄진 대부분의 상태 병합 함수에서 문제 없이 전체 코드를 실행할 수 있게 만듭니다. 하지만 만능은 아니므로 약간의 주의가 필요하며, 가급적 상태 병합에만 사용해야 합니다.

## 상세

### 상태를 얼마나 쪼개는 게 좋나요?

코드의 가독성을 크게 해치지 않는 선에서 최대한 많이 쪼개세요. 또한 최대한 많은 로직을, 최대한 많은 단계의 상태로 감싸세요.

사실, `$`처럼 `get`으로 상태의 값을 가져오는 방식으로 `subscribe`를 만들지 않은 이유 또한 상태를 최대한 많이 쪼개고, `subscribe`는 '최종 상태'만을 다루도록 하기 위함입니다.

암묵적인 '중간 상태'들은 '숨겨져' 있게 되므로 본 라이브러리의 혜택을 상당수 잃고, 불필요한 재계산 및 중간 값 활용 불가능, 복잡해지는 의존성 파악, 코드의 반복, 사이드 이펙트의 멱등성 깨짐, 세세한 생명 주기 및 구독 관리 불가능 등의 문제를 겪을 수 있습니다.

예를 들어, 다음은 상태를 덜 쪼개서 '불필요한 재계산 및 중간 값 활용 불가능'이 발생하는 상황을 보여줍니다.

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

이 코드는 간단하고 깔끔해 보이지만, `userId`와 `postId` 중 하나만 업데이트되어도 두 개의 요청이 다시 보내지며, `user`와 `post`의 레이턴시가 합산되고 (`Promise.all`로 해결 가능하지만 코드 복잡도가 상승합니다.), 관계 없는 사이드 이펙트가 함께 존재해 맥락이 섞이고, `user`나 `post`의 다른 값이 바뀌지 않더라도 `innerHTML`를 바꾸어 DOM이 완전히 갈아엎어지는 등, 여러 문제가 있습니다. 다음과 같이 쪼개야 합니다.

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

코드 줄 수가 약간 늘어났지만, 앞서 언급한 문제들이 해결되었습니다.

아마 너무 간단한 예시라 별로 와닿지 않을 수도 있지만, 현실에서는 아차 하는 순간 자신도 모르게 상태를 뒤섞기 쉬우며, 또 모든 것을 한 곳에서 처리하려는 욕망을 참기 어려운 경우도 종종 발생합니다.

항상 이를 신경쓰며 상태를 쪼개고, 감싸고, 단계를 나누는 것이 중요합니다.

### `onMount`/`onCleanup`은 어떻게 하나요?

상태의 값이 바뀔 때마다가 아니라, 상태가 활성화됐을 때와 비활성화됐을 때(상태를 구독한 곳이 생기기 시작했을 때와 더이상 아무 곳에서도 구독하고 있지 않을 때) 함수를 호출해야 하는 경우가 있습니다. 즉, `onMount`/`onCleanup` (또는 `onDestroy` 등)와 같은 기능이 필요합니다.

이는 두 가지 방법으로 해결할 수 있습니다. 하나는 상태 안에서 상태를 만들어 반환하는 것입니다:

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

`$state`의 수정이 `onMount` 및 `onCleanup` 내에서만 발생하는 경우(가령 외부 이벤트를 구독하는 상황), 가장 깔끔한 패턴입니다. 다음은 이를 응용하여 여러 곳에서 공유하는 연결을 다루는 예시입니다:

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

만약 외부에서 상태를 수정할 수 있어야 한다면, 다음처럼 상태를 두 개 만들 수 있습니다:

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

이제 읽기는 `$reader`로, 쓰기는 `$writer`로 하면 됩니다. `$shared`는 `$writer`에 의존하지 않으므로, `$writer`가 수정되더라도 `$shared`는 업데이트되지 않습니다.

## 예제

#### 디바운스-스로틀링

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

### 스크롤 방향 감지

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
