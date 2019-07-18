/* @flow */

import { createRoute, isSameRoute, isIncludedRoute } from '../util/route'
import { extend } from '../util/misc'

// work around weird flow bug
const toTypes: Array<Function> = [String, Object]
const eventTypes: Array<Function> = [String, Array]

export default {
  name: 'RouterLink',
  props: {
    to: {
      type: toTypes,
      required: true
    },
    tag: {
      type: String,
      default: 'a'
    },
    exact: Boolean,
    append: Boolean,
    replace: Boolean,
    activeClass: String,
    exactActiveClass: String,
    event: {
      type: eventTypes,
      default: 'click'
    }
  },
  render (h: Function) {
    const router = this.$router
    const current = this.$route
    // 根据当前的to的路径，解析出目标路由的路由信息
    const { location, route, href } = router.resolve(this.to, current, this.append)

    // 激活的样式
    const classes = {}
    // 获取全局配置的 向下匹配激活class
    const globalActiveClass = router.options.linkActiveClass
    // 获取全局配置的 精确匹配激活class
    const globalExactActiveClass = router.options.linkExactActiveClass
    // Support global empty active class
    const activeClassFallback = globalActiveClass == null
      ? 'router-link-active'
      : globalActiveClass
    const exactActiveClassFallback = globalExactActiveClass == null
      ? 'router-link-exact-active'
      : globalExactActiveClass
    const activeClass = this.activeClass == null
      ? activeClassFallback
      : this.activeClass
    const exactActiveClass = this.exactActiveClass == null
      ? exactActiveClassFallback
      : this.exactActiveClass
    // 将当前的位置对象  转换成route路由对象
    const compareTarget = location.path
      ? createRoute(null, location, null, router)
      : route

    // 判断当前路由与link的路由对象是否相同
    classes[exactActiveClass] = isSameRoute(current, compareTarget)
    // 如果设置了exact，那么activeClass也是exactActiveClass，否则用路由包含判断
    classes[activeClass] = this.exact
      ? classes[exactActiveClass]
      : isIncludedRoute(current, compareTarget)

    // 处理 event 属性
    const handler = e => {
      if (guardEvent(e)) {
        if (this.replace) {
          router.replace(location)
        } else {
          router.push(location)
        }
      }
    }

    const on = { click: guardEvent }
    if (Array.isArray(this.event)) {
      this.event.forEach(e => { on[e] = handler })
    } else {
      on[this.event] = handler
    }

    // 把class挂载到data上
    const data: any = {
      class: classes
    }

    // 处理tag属性
    if (this.tag === 'a') {
      data.on = on
      data.attrs = { href }
    } else {
      // 如果是其他的标签 tag='div' 那么去寻找第一个后代 a标签，将事件、href放在a标签上
      // find the first <a> child and apply listener and href
      const a = findAnchor(this.$slots.default)
      if (a) {
        // in case the <a> is a static node
        a.isStatic = false
        const aData = a.data = extend({}, a.data)
        aData.on = on
        const aAttrs = a.data.attrs = extend({}, a.data.attrs)
        aAttrs.href = href
      } else {
        // doesn't have <a> child, apply listener to self
        data.on = on
      }
    }

    // 最后用h函数渲染出来
    return h(this.tag, data, this.$slots.default)
  }
}

function guardEvent (e) {
  // don't redirect with control keys
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
  // don't redirect when preventDefault called
  // 防止 默认事件触发
  if (e.defaultPrevented) return
  // don't redirect on right click
  // 防止右键触发
  if (e.button !== undefined && e.button !== 0) return
  // don't redirect if `target="_blank"`
  // 如果设置了target="_blank"
  if (e.currentTarget && e.currentTarget.getAttribute) {
    const target = e.currentTarget.getAttribute('target')
    if (/\b_blank\b/i.test(target)) return
  }
  // this may be a Weex event which doesn't have this method
  if (e.preventDefault) {
    e.preventDefault()
  }
  return true
}

// 找到第一个a标签
function findAnchor (children) {
  if (children) {
    let child
    for (let i = 0; i < children.length; i++) {
      child = children[i]
      if (child.tag === 'a') {
        return child
      }
      if (child.children && (child = findAnchor(child.children))) {
        return child
      }
    }
  }
}
