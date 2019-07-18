/* @flow */

import { _Vue } from '../install'
import type Router from '../index'
import { inBrowser } from '../util/dom'
import { runQueue } from '../util/async'
import { warn, isError } from '../util/warn'
import { START, isSameRoute } from '../util/route'
import {
  flatten,
  flatMapComponents,
  resolveAsyncComponents
} from '../util/resolve-components'

export class History {
  router: Router;
  base: string;
  current: Route;
  pending: ?Route;
  cb: (r: Route) => void;
  ready: boolean;
  readyCbs: Array<Function>;
  readyErrorCbs: Array<Function>;
  errorCbs: Array<Function>;

  // implemented by sub-classes
  +go: (n: number) => void;
  +push: (loc: RawLocation) => void;
  +replace: (loc: RawLocation) => void;
  +ensureURL: (push?: boolean) => void;
  +getCurrentLocation: () => string;

  // base是实例化router传的base参数
  // 是应用的基路径。例如，如果整个单页应用服务在 /app/ 下，然后 base 就应该设为 "/app/"
  constructor (router: Router, base: ?string) {
    this.router = router
    this.base = normalizeBase(base)
    // start with a route object that stands for "nowhere"
    this.current = START
    this.pending = null
    this.ready = false
    this.readyCbs = []
    this.readyErrorCbs = []
    this.errorCbs = []
  }

  listen (cb: Function) {
    this.cb = cb
  }

  onReady (cb: Function, errorCb: ?Function) {
    if (this.ready) {
      cb()
    } else {
      this.readyCbs.push(cb)
      if (errorCb) {
        this.readyErrorCbs.push(errorCb)
      }
    }
  }

  onError (errorCb: Function) {
    this.errorCbs.push(errorCb)
  }

  /*
      路由跳转核心方法。
      this.$router.push(location, onComplete?, onAbort?)
    location :   地址路径
      1、 可以直接为一个地址的字符串，如 'base/home'
      2、 可以为一个地址对象  {
          _normalized?: boolean;
          name?: string;
          path?: string;
          hash?: string;
          query?: Dictionary<string>;
          params?: Dictionary<string>;
          append?: boolean;
          replace?: boolean;
      }
  */
  transitionTo (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // location是hash，this.current是START
    /* START = createRoute(null, {
        path: '/'
      })
    */
    const route = this.router.match(location, this.current)
    this.confirmTransition(route, () => {
      this.updateRoute(route)
      onComplete && onComplete(route)
      this.ensureURL()

      // fire ready cbs once
      if (!this.ready) {
        this.ready = true
        this.readyCbs.forEach(cb => { cb(route) })
      }
    }, err => {
      if (onAbort) {
        onAbort(err)
      }
      if (err && !this.ready) {
        this.ready = true
        this.readyErrorCbs.forEach(cb => { cb(err) })
      }
    })
  }

  confirmTransition (route: Route, onComplete: Function, onAbort?: Function) {
    const current = this.current
    const abort = err => {
      if (isError(err)) {
        if (this.errorCbs.length) {
          this.errorCbs.forEach(cb => { cb(err) })
        } else {
          warn(false, 'uncaught error during route navigation:')
          console.error(err)
        }
      }
      onAbort && onAbort(err)
    }
    if (
      // 1. 一开始current的path是'/'，最初访问页面时route.path也是'/'，但current.matched是[]，而route.matched不是空数组，所以isSameRoute是false
      // 2. 前后两次访问的路由确实相同，isSameRoute是true，会执行ensureURL，但执行abort时，err是undefined，所以会执行到abort里的onAbort，但onAbort是undefined，所以就跳过了。
      // 所以，在init函数里，给transitionTo传的onAbort参数setupHashListener，无论如何，都不会被执行
      isSameRoute(route, current) &&
      // in the case the route map has been dynamically appended to
      route.matched.length === current.matched.length
    ) {
      // 修改当前的历史状态，不产生新的历史状态
      this.ensureURL()
      return abort()
    }

    const {
      updated,
      deactivated,
      activated
    } = resolveQueue(this.current.matched, route.matched)

    // 完整的导航解析流程:
    /*
      导航被触发。
      在失活的组件里调用离开守卫。
      调用全局的 beforeEach 守卫。
      在重用的组件里调用 beforeRouteUpdate 守卫 (2.2+)。
      在路由配置里调用 beforeEnter。
      解析异步路由组件。
      在被激活的组件里调用 beforeRouteEnter。
      调用全局的 beforeResolve 守卫 (2.5+)。
      导航被确认。
      调用全局的 afterEach 钩子。
      触发 DOM 更新。
      用创建好的实例调用 beforeRouteEnter 守卫中传给 next 的回调函数。
    */
    // 一系列钩子函数的队列
    //
    const queue: Array<?NavigationGuard> = [].concat(
      // in-component leave guards
      extractLeaveGuards(deactivated),
      // global before hooks
      // 这是用户自定义的
      /*
        const router = new VueRouter(...)
        router.beforeEach(...)
      */
      this.router.beforeHooks,
      // in-component update hooks
      extractUpdateHooks(updated),
      // in-config enter guards
      // beforeEnter是在每个路由配置里写的
      activated.map(m => m.beforeEnter),
      // async components
      // resolveAsyncComponents返回的是一个钩子函数，格式是(to, from, next) => {...}
      // 真正执行异步组件解析的是这个钩子函数，会在runQueue中执行
      resolveAsyncComponents(activated)
    )

    // 在执行路由钩子函数队列之前，会先将this.pending设置为route
    // 在调用全局的 beforeResolve 守卫后，再将this.pending设置为null
    // TODO: 但是runQueue方法可以保证按顺序执行的呀，为啥还需要this.pending？？
    this.pending = route
    // iterator是实际执行钩子函数的函数
    const iterator = (hook: NavigationGuard, next) => {
      if (this.pending !== route) {
        return abort()
      }
      try {
        // 参数对应api文档中说的：to, from, next
        // to是next的参数
        hook(route, current, (to: any) => {
          if (to === false || isError(to)) {
            // next(false) -> abort navigation, ensure current URL
            this.ensureURL(true)
            abort(to)
          } else if (
            typeof to === 'string' ||
            (typeof to === 'object' && (
              typeof to.path === 'string' ||
              typeof to.name === 'string'
            ))
          ) {
            // next('/') or next({ path: '/' }) -> redirect
            abort()
            if (typeof to === 'object' && to.replace) {
              this.replace(to)
            } else {
              this.push(to)
            }
          } else {
            // confirm transition and pass on the value
            next(to)
          }
        })
      } catch (e) {
        abort(e)
      }
    }

    runQueue(queue, iterator, () => {
      const postEnterCbs = []
      const isValid = () => this.current === route
      // wait until async components are resolved before
      // extracting in-component enter guards
      const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid)
      const queue = enterGuards.concat(this.router.resolveHooks)
      runQueue(queue, iterator, () => {
        if (this.pending !== route) {
          return abort()
        }
        this.pending = null
        onComplete(route)
        if (this.router.app) {
          this.router.app.$nextTick(() => {
            postEnterCbs.forEach(cb => { cb() })
          })
        }
      })
    })
  }

  updateRoute (route: Route) {
    const prev = this.current
    this.current = route
    this.cb && this.cb(route)
    this.router.afterHooks.forEach(hook => {
      hook && hook(route, prev)
    })
  }
}

// 规范化base
function normalizeBase (base: ?string): string {
  if (!base) {
    if (inBrowser) {
      // respect <base> tag
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin
      base = base.replace(/^https?:\/\/[^\/]+/, '')
    } else {
      base = '/'
    }
  }
  // make sure there's the starting slash
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // remove trailing slash
  return base.replace(/\/$/, '')
}

// 因为 route.matched 是一个 RouteRecord 的数组（且顺序是先父后己），
// 由于路径是由 current 变向 route，那么就遍历对比 2 边的 RouteRecord，
// 找到一个不一样的位置 i，那么 next 中从 0 到 i 的 RouteRecord 是两边都一样，则为 updated 的部分；
// 从 i 到最后的 RouteRecord 是 next 独有的，为 activated 的部分；
// 而 current 中从 i 到最后的 RouteRecord 则没有了，为 deactivated 的部分。
/*
 current  : [{ path : '/parent' }, { path : '/parent/qux/:quxId'}]
 next  : [{ path : '/parent' }, { path : '/parent/quy/:quyId'}]
*/
function resolveQueue (
  current: Array<RouteRecord>,
  next: Array<RouteRecord>
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  const max = Math.max(current.length, next.length)
  for (i = 0; i < max; i++) {
    if (current[i] !== next[i]) {
      break
    }
  }
  return {
    updated: next.slice(0, i),
    activated: next.slice(i),
    deactivated: current.slice(i)
  }
}

// 返回一个一层数组
function extractGuards (
  records: Array<RouteRecord>, // 要解析的路由表
  name: string, // 导航守卫的名字，如beforeRouteLeave，beforeRouteEnter
  bind: Function,
  reverse?: boolean // 是否翻转，解析beforeRouteLeave钩子的时候为true
): Array<?Function> {
  // flatMapComponents返回的是records中每个路由执行fn后的结果数组
  const guards = flatMapComponents(records, (def, instance, match, key) => {
    const guard = extractGuard(def, name)
    if (guard) {
      return Array.isArray(guard)
        ? guard.map(guard => bind(guard, instance, match, key))
        : bind(guard, instance, match, key)
    }
  })
  // 把二层数组打平成一层
  return flatten(reverse ? guards.reverse() : guards)
}

function extractGuard (
  def: Object | Function,
  key: string
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    // extend now so that global mixins are applied.
    def = _Vue.extend(def)
  }
  return def.options[key]
}

function extractLeaveGuards (deactivated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
}

function extractUpdateHooks (updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate', bindGuard)
}

function bindGuard (guard: NavigationGuard, instance: ?_Vue): ?NavigationGuard {
  if (instance) {
    return function boundRouteGuard () {
      return guard.apply(instance, arguments)
    }
  }
}

// extractEnterGuards利用了 extractGuards 方法提取组件中的 beforeRouteEnter 导航钩子函数，和之前不同的是 bind 方法的不同。文档中特意强调了 beforeRouteEnter 钩子函数中是拿不到组件实例的，因为当守卫执行前，组件实例还没被创建，但是我们可以通过传一个回调给 next 来访问组件实例。在导航被确认的时候执行回调，并且把组件实例作为回调方法的参数：
function extractEnterGuards (
  activated: Array<RouteRecord>,
  cbs: Array<Function>,
  isValid: () => boolean
): Array<?Function> {
  // guard是从extractGuards函数里传入的
  return extractGuards(activated, 'beforeRouteEnter', (guard, _, match, key) => {
    return bindEnterGuard(guard, match, key, cbs, isValid)
  })
}

function bindEnterGuard (
  guard: NavigationGuard,
  match: RouteRecord,
  key: string,
  cbs: Array<Function>,
  isValid: () => boolean
): NavigationGuard {
  // 在执行iterator中的hook时，就相当于执行这个routeEnterGuard函数
  return function routeEnterGuard (to, from, next) {
    return guard(to, from, cb => {
      if (typeof cb === 'function') {
        cbs.push(() => {
          // #750
          // if a router-view is wrapped with an out-in transition,
          // the instance may not have been registered at this time.
          // we will need to poll for registration until current route
          // is no longer valid.
          poll(cb, match.instances, key, isValid)
        })
      }
      next(cb)
    })
  }
}

function poll (
  cb: any, // somehow flow cannot infer this is a function
  instances: Object,
  key: string,
  isValid: () => boolean
) {
  if (
    instances[key] &&
    !instances[key]._isBeingDestroyed // do not reuse being destroyed instance
  ) {
    cb(instances[key])
  } else if (isValid()) {
    setTimeout(() => {
      poll(cb, instances, key, isValid)
    }, 16)
  }
}
