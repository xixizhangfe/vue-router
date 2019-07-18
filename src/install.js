import View from './components/view'
import Link from './components/link'

export let _Vue

// Vue.use(VueRouter)会执行install函数
export function install (Vue) {
  // 如果已经执行过Vue.use(VueRouter)，则返回
  if (install.installed && _Vue === Vue) return
  install.installed = true

  // 缓存Vue
  _Vue = Vue

  const isDef = v => v !== undefined

  const registerInstance = (vm, callVal) => {
    let i = vm.$options._parentVnode
    // TODO: registerRouteInstance什么时候定义
    if (isDef(i) && isDef(i = i.data) && isDef(i = i.registerRouteInstance)) {
      i(vm, callVal)
    }
  }

  // 定义全局混合方法，使每一个组件都混入beforeCreate、destroyed方法
  Vue.mixin({
    beforeCreate () {
      // this.$options.router是我们在new Vue时传入的router，也就是vueRouter的实例
      // 只有根实例才会有this.$options.router
      // 所以所有vue实例都挂载了_routerRoot，根实例还挂载了_router
      if (isDef(this.$options.router)) {
        this._routerRoot = this
        this._router = this.$options.router
        // 执行router实例的init方法
        this._router.init(this)
        // 把根 Vue 实例的 _route 属性定义成响应式的，我们在每个 <router-view> 执行
        // render 函数的时候，都会访问 parent.$route，也就是会访问
        // this._routerRoot._route，触发了它的 getter，相当于 <router-view> 对它有依
        // 赖，然后再执行完 transitionTo 后，修改 app._route 的时候（index.js里init函数history.listen回调函数会执行修改操作），又触发了setter，因
        // 此会通知 <router-view> 的渲染 watcher 更新，重新渲染组件。
        Vue.util.defineReactive(this, '_route', this._router.history.current)
      } else {
        this._routerRoot = (this.$parent && this.$parent._routerRoot) || this
      }
      registerInstance(this, this)
    },
    destroyed () {
      registerInstance(this)
    }
  })

  // 定义$router在原型上，这样我们就可以在vue实例中通过this.$router来访问
  Object.defineProperty(Vue.prototype, '$router', {
    get () { return this._routerRoot._router }
  })

  // 定义$route在原型上，这样我们就可以在vue实例中通过this.$route来访问
  Object.defineProperty(Vue.prototype, '$route', {
    get () { return this._routerRoot._route }
  })

  // 注册全局组件：router-view，router-link
  Vue.component('RouterView', View)
  Vue.component('RouterLink', Link)

  // 获取vue的合并策略
  const strats = Vue.config.optionMergeStrategies
  // use the same hook merging strategy for route hooks
  // route hook的合并策略与vue的hook合并策略相同
  strats.beforeRouteEnter = strats.beforeRouteLeave = strats.beforeRouteUpdate = strats.created
}
