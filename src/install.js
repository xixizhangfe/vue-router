import View from './components/view'
import Link from './components/link'

export let _Vue

export function install (Vue) {
  if (install.installed && _Vue === Vue) return
  install.installed = true

  _Vue = Vue

  const isDef = v => v !== undefined

  const registerInstance = (vm, callVal) => {
    let i = vm.$options._parentVnode
    // TODO: registerRouteInstance什么时候定义
    if (isDef(i) && isDef(i = i.data) && isDef(i = i.registerRouteInstance)) {
      i(vm, callVal)
    }
  }

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
        // this._route是响应式
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
